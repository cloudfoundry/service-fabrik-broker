'use strict';

const _ = require('lodash');
const riemannClient = require('riemannjs');
const logger = require('../logger');
const config = require('../config');
const pubsub = require('pubsub-js');
const CONST = require('../constants');

class EventLogRiemannClient {
  constructor(options) {
    this.isInitializing = false;
    this.isInitialized = false;
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
      logger.debug('Connecting to Riemann');
      this.isInitializing = true;
      this.riemannClient = riemannClient.createClient({
        host: this.options.host,
        port: this.options.port,
        transport: this.options.protocol
      });
      this.riemannClient.on('connect', () => {
        this.isInitializing = false;
        this.isInitialized = true;
        logger.debug('Connected to Riemann');
        // Process requests enqued while riemann client was getting initialized
        if(this._isRequestQueueNonEmpty()) {
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
        logger.debug('Disconnected from Riemann!');
        this.isInitializing = false;
        this.isInitialized = false;
      });
    } catch (err) {
      this.isInitializing = false;
      this.isInitialized = false;
      if (this.options.show_errors) {
        logger.warn('Error initializing Riemann', err);
      }
      //Just log & do not propogate errors due to event logging
      //Event logging should in no way affect main event loop
      return;
    }
  }

  disconnect() {
    logger.info('Disconnecting Riemann');
    this.isInitializing = false;
    if (this.isInitialized) {
      this.isInitialized = false;
      this.riemannClient.disconnect();
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
   * This method suffixes the instance_id if avaialble or backup guid if avaialble or instance_id if avaialble to event name to provide more information in the email alerts
   */
  suffixGuidsToEventName(eventInfo) {
    var eventName = eventInfo.eventName;
    const instanceId = _.get(eventInfo, 'request.instance_id');
    const backupGuid = _.get(eventInfo, 'request.backup_guid');
    const appGuid = _.get(eventInfo, 'request.app_guid');

    if (instanceId === undefined && backupGuid === undefined && appGuid === undefined) {
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
    this.sendEvent(info, 0);
  }

  sendEvent(info, attempt) {
    let messageSent = false;
    // Attempt to send event 2 times as enqueing request is also considered 1 attempt
    while (!messageSent && attempt++ < CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_SEND_RETRIES) {
      try {
        logger.debug(`Trying to send event to riemann, attempt ${attempt} : `  , info);
        let enqueRequest = false;
        if (!this.isInitialized && !this.isInitializing) {
          this.initialize();
          enqueRequest = true;
        } else if(this.isInitializing) {
          enqueRequest = true
        }
        if(enqueRequest) {
          this._enqueRequest(info, attempt);
          return;
        }
        this.riemannClient.send(this.riemannClient.Event(info));
        logger.debug('logging following to riemann : ', info);
        messageSent = true;
      } catch (err) {
        this.disconnect();
        if (this.options.show_errors) {
          logger.error(`Error occurred while sending event to Riemann, attempt ${attempt} `, err);
        }
      }
    }
    if(!messageSent && attempt >= CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_SEND_RETRIES) {
      logger.error(`Event could not be sent to Riemann, max retries ${CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_SEND_RETRIES} exceeded : `, info);
    }
  }
  _enqueRequest(info, attempt) {
    if(this.QUEUED_REQUESTS.length >= CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_QUEUE_SIZE) {
      logger.error(`Exceeded max queue size ${CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_QUEUE_SIZE} for outstanding riemann events, dequeue first event`);
      let request = this._dequeRequest();
      logger.error(`Request discarded - `, request.info);
    }
    this.QUEUED_REQUESTS.push({
      info: info,
      attempt: attempt
    });
    logger.debug(`Request queued: `, info);
  }

  _dequeRequest() {
    return this.QUEUED_REQUESTS.length === 0 ? null : this.QUEUED_REQUESTS.shift();
  }

  _isRequestQueueNonEmpty() {
    return this.QUEUED_REQUESTS && this.QUEUED_REQUESTS.length > 0;
  }

  _processOutStandingRequest() {
    logger.info(`Processing outstanding Riemann event send requests.. Queued Count: ${this.QUEUED_REQUESTS.length}`);
    while(this._isRequestQueueNonEmpty()) {
      let request = this._dequeRequest();
      if (request !== null) {
        logger.info(`Processing queued up request: `, request.info);
        this.sendEvent(request.info, request.attempt);
      }
    }
  }
}
module.exports = EventLogRiemannClient;