'use strict';

// eslint-disable-next-line no-console
console.log('Starting Service Fabrik Quota Check Application...');

const { ExpressApp, HttpServer } = require('@sf/express-commons');
const logger = require('@sf/logger');
const config = require('@sf/app-config');
const { CONST } = require('@sf/common-utils');
const { utils } = require('@sf/eventmesh');
const routes = require('./routes');

async function init() {
  try {
    if (config.apiserver.isServiceDefinitionAvailableOnApiserver) {
      await utils.loadCatalogFromAPIServer();
    }
    const quotaApp = ExpressApp.create('quota_app', app => {
      // home
      app.get('/', (req, res) => {
        res.render('index', {
          title: app.get('title')
        });
      });
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
