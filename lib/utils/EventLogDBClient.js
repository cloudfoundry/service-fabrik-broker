'use strict';

const _ = require('lodash');
const pubsub = require('pubsub-js');
const config = require('../config');
const logger = require('../logger');
const Repository = require('../db').Repository;
const CONST = require('../constants');

class EventLogDBClient {
  constructor(options) {
    this.options = options;
    const eventNames = _.get(config, 'monitoring.events_logged_in_db', '').replace(/\s*/g, '');
    this.eventsToBeLoggedInDB = eventNames.split(',');
    if (_.get(options, 'event_type')) {
      pubsub.subscribe(options.event_type, (message, data) => this.handleEvent(message, data));
      logger.debug(`EventLoggerDBClient subscribed to event ${options.event_type}`);
    } else {
      logger.info('Event Type for EventLogDBClient is empty.!');
    }
  }

  handleEvent(message, data) {
    if (data.event && data.event.eventName) {
      const completeEventName = data.event.eventName;
      const parsedEventName = data.event.eventName.split('.');
      const eventName = parsedEventName[parsedEventName.length - 1];
      if (eventName && this.eventsToBeLoggedInDB.indexOf(eventName) !== -1) {
        logger.debug(`${eventName} configured to be logged into DB`);
        const eventInfo = _.cloneDeep(data.event);
        eventInfo.eventName = eventName;
        eventInfo.completeEventName = completeEventName;
        this.logEvent(eventInfo);
      }
    }
  }

  logEvent(eventInfo) {
    eventInfo.instanceId = _.get(eventInfo, 'request.instance_id') || _.get(eventInfo, 'request.instance_guid') ||
      _.get(eventInfo, 'response.instance_id') || _.get(eventInfo, 'response.instance_guid', 'NA');
    //Pick instance id either from request / response attribs
    const user = _.get(eventInfo, 'request.user', CONST.SYSTEM_USER);
    logger.debug('event being written to DB - ', eventInfo);
    Repository.save(CONST.DB_MODEL.EVENT_DETAIL, eventInfo, user);
  }
}

module.exports = EventLogDBClient;