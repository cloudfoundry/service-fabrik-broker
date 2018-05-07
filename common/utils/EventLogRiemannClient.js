'use strict';

const _ = require('lodash');
const riemannClient = require('riemannjs');
const logger = require('../logger');
const config = require('../config');
const pubsub = require('pubsub-js');
const CONST = require('../constants');

class EventLogRiemannClient {
  constructor(options) {
    this.isInitialized = false;
    this.options = options;
    if (options.event_type) {
      pubsub.subscribe(options.event_type, (message, data) => this.handleEvent(message, _.cloneDeep(data)));
    }
    pubsub.subscribe(CONST.TOPIC.APP_SHUTTING_DOWN, () => this.disconnect());
    this.initialize(options);
  }

  initialize() {
    try {
      this.riemannClient = riemannClient.createClient({
        host: this.options.host,
        port: this.options.port,
        transport: this.options.protocol
      });
      this.riemannClient.on('connect', () => {
        this.isInitialized = true;
        logger.debug('Connected to Riemann');
        //TODO : Some messages might be dropped during initialization or might trigger reinitialize
      });
      this.riemannClient.on('error', (err) => {
        if (this.options.show_errors) {
          logger.warn('error occurred with riemann ', err);
        }
        this.isInitialized = false;
      });
      this.riemannClient.on('disconnect', () => {
        logger.debug('Disconnected from Riemann!');
        this.isInitialized = false;
      });
    } catch (err) {
      if (this.options.show_errors) {
        logger.warn('Error initializing Riemann', err);
      }
      //Just log & do not propogate errors due to event logging
      //Event logging should in no way affect main event loop
      return;
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

  disconnect() {
    logger.info('Disconnecting Riemann');
    if (this.isInitialized) {
      this.isInitialized = false;
      this.riemannClient.disconnect();
    }
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
    let attempt = 0;
    let messageSent = false;
    do {
      try {
        if (!this.isInitialized) {
          this.initialize();
        }
        this.riemannClient.send(this.riemannClient.Event(info));
        logger.debug('logging following to riemann : ', info);
        messageSent = true;
      } catch (err) {
        this.isInitialized = false;
        if (this.options.show_errors) {
          logger.error('Error occurred while sending event to Riemann ', err);
        }
      }
    } while (!messageSent && ++attempt < 2);
  }
}
module.exports = EventLogRiemannClient;