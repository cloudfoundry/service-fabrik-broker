'use strict';

const _ = require('lodash');
const riemannClient = require('riemannjs');
const logger = require('../logger');
const config = require('../config');
const pubsub = require('pubsub-js');
const CONST = require('../constants');
const catalog = require('../models').catalog;

class EventLogRiemannClient {
  constructor(options) {
    this.status = CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.DISCONNECTED;
    this.QUEUED_REQUESTS = [];
    this.options = options;
    if (options.event_type) {
      pubsub.subscribe(options.event_type, (message, data) => this.handleEvent(message, _.cloneDeep(data)));
    }
    pubsub.subscribe(CONST.TOPIC.APP_SHUTTING_DOWN, () => this.disconnect());
    this.initialize(options);
  }

  initialize() {
    try {
      logger.info('Connecting to Riemann');
      this.status = CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.INITIALIZING;
      this.riemannClient = riemannClient.createClient({
        host: this.options.host,
        port: this.options.port,
        transport: this.options.protocol
      });
      this.riemannClient.on('connect', () => {
        this.status = CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.CONNECTED;
        logger.info('Connected to Riemann');
        // Process requests enqued while riemann client was getting initialized
        if (this._isRequestQueueNonEmpty()) {
          this._processOutStandingRequest();
        }
      });
      this.riemannClient.on('error', (err) => {
        if (this.options.show_errors) {
          logger.warn('error occurred with riemann ', err);
        }
        this.disconnect();
      });
      this.riemannClient.on('disconnect', () => {
        logger.info('Disconnected from Riemann!');
        this.status = CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.DISCONNECTED;
      });
    } catch (err) {
      this.disconnect();
      if (this.options.show_errors) {
        logger.warn('Error initializing Riemann', err);
      }
      //Just log & do not propogate errors due to event logging
      //Event logging should in no way affect main event loop
      return;
    }
  }

  disconnect() {
    try {
      this.status = CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.DISCONNECTED;
      this.riemannClient.disconnect();
      logger.info('Disconnected from Riemann');
    } catch (err) {
      logger.warn('Error in disconnecting from Riemann', err);
    }
  }

  handleEvent(message, data) {
    try {
      if (data.event && !this.skipBasedOnHttpResponseCodes(_.get(data, 'event.response.status'), _.get(config, 'riemann.http_status_codes_to_be_skipped'))) {
        this.logEvent(data.event, data.options);
        //Added to log additional event with instance id or backup guid suffix to the name to provide more details to email alerts
        if (_.get(config, 'riemann.log_additional_event', true) && typeof data.event.request === 'object' && this.suffixGuidsToEventName(data.event)) {
          this.logEvent(data.event, data.options);
        }
      }
    } catch (err) {
      logger.warn('Exception occurred while processing event', err);
    }
  }

  /**
   * This method suffixes the instance_id if avaialble or backup guid if avaialble or instance_id if avaialble or service_name if avaialble to event name to provide more information in the email alerts
   */
  suffixGuidsToEventName(eventInfo) {
    var eventName = eventInfo.eventName;
    const instanceId = _.get(eventInfo, 'request.instance_id');
    const backupGuid = _.get(eventInfo, 'request.backup_guid');
    const appGuid = _.get(eventInfo, 'request.app_guid');
    const serviceId = _.get(eventInfo, 'request.service_id');

    if (instanceId === undefined && backupGuid === undefined && appGuid === undefined && serviceId === undefined) {
      return false;
    } else {
      if (instanceId !== undefined) {
        eventName = `${eventName}.instance_id.${instanceId}`;
      }

      if (backupGuid !== undefined) {
        eventName = `${eventName}.backup_guid.${backupGuid}`;
      }

      if (appGuid !== undefined) {
        eventName = `${eventName}.app_guid.${appGuid}`;
      }

      if (serviceId !== undefined) {
        let serviceName = catalog.getServiceName(serviceId);
        eventName = `${eventName}.service_name.${serviceName}`;
      }
    }
    eventInfo.eventName = eventName;
    return true;
  }

  skipBasedOnHttpResponseCodes(httpResponseCode, httpResponseCodesToSkip) {
    return _.indexOf(httpResponseCodesToSkip, httpResponseCode) !== -1;
  }

  logEvent(eventInfo, options) {
    //Transforming app specific event Information to Riemann specific format.
    const info = _
      .chain(eventInfo)
      .pick('metric', 'state', 'description', 'tags')
      .set('service', eventInfo.eventName)
      .set('host', _.get(config, 'riemann.prefix', 'CF'))
      .set('attributes', [{
        key: 'request',
        value: (typeof eventInfo.request === 'object' ? JSON.stringify(eventInfo.request) : eventInfo.request)
      }])
      .tap(event => {
        if (_.get(options, 'include_response_body', false) || _.get(config, 'monitoring.include_response_body', false)) {
          event.attributes.push({
            key: 'response',
            value: (typeof eventInfo.response === 'object' ? JSON.stringify(eventInfo.response) : eventInfo.response)
          });
        }
      })
      .value();
    this.sendEvent(info, 1);
  }

  sendEvent(info, attempt) {
    if (attempt <= CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_SEND_RETRIES) {
      if (this.status === CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.DISCONNECTED) {
        this._enqueRequest(info, attempt);
        this.initialize();
        // returning false as other events in queue will also end up queuing again
        return false;
      } else if (this.status === CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.INITIALIZING) {
        this._enqueRequest(info, attempt);
        // returning false as other events in queue will also end up queuing again
        return false;
      } else {
        try {
          logger.debug(`Trying to send event to riemann, attempt ${attempt} : `, info);
          this.riemannClient.send(this.riemannClient.Event(info));
          logger.debug('logging following to riemann : ', info);
          // returning true as other events in queue can be processed successfully
          return true;
        } catch (err) {
          this.disconnect();
          this._enqueRequest(info, attempt + 1);
          this.initialize();
          if (this.options.show_errors) {
            logger.error(`Error occurred while sending event to Riemann, attempt ${attempt} `, err);
          }
          // returning false as other events in queue will also end up queuing again
          return false;
        }
      }
    } else {
      logger.error(`Event could not be sent to Riemann, max retries ${CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_SEND_RETRIES} exceeded : `, info);
      // returning true as this event is discarded due to max attempts reached
      // but other events in queue can be processed successfully
      return true;
    }
  }

  _enqueRequest(info, attempt) {
    if (this.QUEUED_REQUESTS.length >= CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_QUEUE_SIZE) {
      logger.error(`Exceeded max queue size ${CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_QUEUE_SIZE} for outstanding riemann events, dequeue first event`);
      const request = this._dequeRequest();
      logger.error(`Request discarded : `, request.info);
    }
    this.QUEUED_REQUESTS.push({
      info: info,
      attempt: attempt
    });
    logger.debug(`Request queued : `, info);
  }

  _dequeRequest() {
    return this.QUEUED_REQUESTS.length === 0 ? null : this.QUEUED_REQUESTS.shift();
  }

  _isRequestQueueNonEmpty() {
    return this.QUEUED_REQUESTS && this.QUEUED_REQUESTS.length > 0;
  }

  _processOutStandingRequest() {
    logger.debug(`Processing outstanding Riemann event send requests.. Queued Count: ${this.QUEUED_REQUESTS.length}`);
    while (this._isRequestQueueNonEmpty()) {
      const request = this._dequeRequest();
      if (request !== null) {
        logger.debug(`Processing queued up request: `, request.info);
        if (!this.sendEvent(request.info, request.attempt)) {
          break; //Incase of an exception during retry. Stop processing queue items as all of them end up going back in queue.
        }
      }
    }
  }
}
module.exports = EventLogRiemannClient;