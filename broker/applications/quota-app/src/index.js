/* jshint ignore:start */
'use strict';

// eslint-disable-next-line no-console
console.log('Starting Service Fabrik Quota Check Application...');

const { ExpressApp, HttpServer } = require('@sf/express-commons');
const logger = require('@sf/logger');
const { CONST } = require('@sf/common-utils');
const routes = require('./routes');

async function init() {
  try {
    const quotaApp = ExpressApp.create('quotaApp', app => {
      app.use('/v1', routes.v1);
    });
    HttpServer.start(quotaApp);
    HttpServer.handleShutdown(); // https://github.com/nodejs/node-v0.x-archive/issues/5054
  } catch (error) {
    logger.info('Process shutting down now because of error ', error);
    process.exit(CONST.ERR_CODES.UNCAUGHT_FATAL_EXCEPTION);
  }
}

init();
/* jshint ignore:end */
