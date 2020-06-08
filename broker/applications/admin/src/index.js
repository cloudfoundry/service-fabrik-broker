'use strict';

// eslint-disable-next-line no-console
console.log('Starting Service Fabrik Admin Application...');

const { ExpressApp, HttpServer } = require('@sf/express-commons');
const logger = require('@sf/logger');
const { CONST } = require('@sf/common-utils');
const admin = require('./admin');

async function init() {
  try {
    const adminApp = ExpressApp.create('admin_app', app => {
      // home
      app.get('/', (req, res) => {
        res.render('index', {
          title: app.get('title')
        });
      });
      app.use('/admin', admin);
    });
    HttpServer.start(adminApp);
    HttpServer.handleShutdown(); // https://github.com/nodejs/node-v0.x-archive/issues/5054
  } catch (error) {
    logger.info('Process shutting down now because of error ', error);
    process.exit(CONST.ERR_CODES.UNCAUGHT_FATAL_EXCEPTION);
  }
}

init();
/* jshint ignore:end */
