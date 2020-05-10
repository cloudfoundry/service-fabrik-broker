/* jshint ignore:start */
'use strict';

// eslint-disable-next-line no-console
console.log('Starting Service Fabrik Extensions Server...');

const { ExpressApp, HttpServer } = require('@sf/express-commons');
const logger = require('@sf/logger');
const { CONST } = require('@sf/common-utils');
const routes = require('./api-controllers/routes');

async function init() {
  try {
    const external = ExpressApp.create('external', app => {
      // home
      app.get('/', (req, res) => {
        res.render('index', {
          title: app.get('title')
        });
      });
      // service fabrik api
      app.use('/api', routes.api);
      app.use('/manage', routes.manage);
    });
    HttpServer.start(external);
    HttpServer.handleShutdown(); // https://github.com/nodejs/node-v0.x-archive/issues/5054
  } catch (error) {
    logger.info('Process shutting down now because of error ', error);
    process.exit(CONST.ERR_CODES.UNCAUGHT_FATAL_EXCEPTION);
  }
}

init();
/* jshint ignore:end */
