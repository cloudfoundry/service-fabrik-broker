'use strict';

const net = require('net');
const pubsub = require('pubsub-js');
const config = require('@sf/app-config');
const logger = require('@sf/logger');

class EventLogDomainSocketClient {
  constructor(options) {
    this.options = options;
    if (!options.path) {
      throw new Error('Domain socket path cannot be empty');
    }
    if (options.event_type) {
      pubsub.subscribe(options.event_type, (message, data) => this.handleEvent(message, data));
    } else {
      logger.info('Event Type for DomainSocketClient is empty.!');
    }
    logger.debug('Domain Socket listener - initialized with options ', options);
  }

  handleEvent(message, data) {
    if (data.event) {
      const eventName = data.event.eventName;
      if ((eventName.indexOf('create_instance') > 0 || eventName.indexOf('delete_instance') > 0) &&
        data.event.metric === config.monitoring.success_metric) {
        // For now just forwarding create/delete success events to  domain socket.
        // But in future all events could be forwarded. This is just an optimization for now.
        this.logEvent(data.event);
      }
    }
  }

  logEvent(eventInfo) {
    logger.debug('event being written to domain Socket - ', eventInfo);
    const client = net.createConnection(this.options.path, () => {
      client.write(JSON.stringify(eventInfo));
      client.end();
    }).on('error', err => {
      logger.error('error occurred while writing  to domain socket', err);
    });
  }
}

module.exports = EventLogDomainSocketClient;
