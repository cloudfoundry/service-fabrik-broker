'use strict';

const _ = require('lodash');
const config = require('@sf/app-config');
const {
  commonFunctions: {
    isDBConfigured
  }
} = require('@sf/common-utils');
const EventLogRiemannClient = require('./EventLogRiemannClient');
const EventLogDomainSocketClient = require('./EventLogDomainSocketClient');
const EventLogDBClient = require('./EventLogDBClient');
const EventLogInterceptor = require('./EventLogInterceptor');

exports.EventLogInterceptor = EventLogInterceptor;
exports.initializeEventListener = function (appConfig, appType) {
  const riemannOptions = _
    .chain({})
    .assign(config.riemann)
    .set('event_type', appConfig.event_type)
    .value();
  if (riemannOptions.enabled !== false) {
    const riemannClient = new EventLogRiemannClient(riemannOptions); // eslint-disable-line no-unused-vars
  }
  // if events are to be forwarded to monitoring agent via domain socket
  if (appConfig.domain_socket && _.get(appConfig, 'domain_socket.fwd_events')) {
    /* jshint unused:false */
    const domainSockOptions = _
      .chain({})
      .set('event_type', appConfig.event_type)
      .set('path', appConfig.domain_socket.path)
      .value();
    const domainSockClient = new EventLogDomainSocketClient(domainSockOptions); // eslint-disable-line no-unused-vars
  }
  if (isDBConfigured()) {
    const domainSockClient = new EventLogDBClient({ // eslint-disable-line no-unused-vars
      event_type: appConfig.event_type
    });
  }
  return EventLogInterceptor.getInstance(appConfig.event_type, appType);
};
