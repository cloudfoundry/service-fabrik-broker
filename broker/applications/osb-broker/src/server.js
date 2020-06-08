/* jshint ignore:start */
'use strict';

// eslint-disable-next-line no-console
console.log('Starting Service Fabrik OSB Server...');
const _ = require('lodash');
const routes = require('./api-controllers/routes');
const { ExpressApp, HttpServer } = require('@sf/express-commons');
const config = require('@sf/app-config');
const { utils, UnlockResourcePoller } = require('@sf/eventmesh');
const logger = require('@sf/logger');
const { CONST } = require('@sf/common-utils');

async function init() {
  try {
    await utils.registerSFEventsCrd();
    await utils.waitWhileCRDsAreRegistered();
    if (config.apiserver.isServiceDefinitionAvailableOnApiserver) {
      await utils.loadCatalogFromAPIServer();
    } else{
      await utils.pushServicePlanToApiServer();
    }
    const internal = ExpressApp.create('internal', app => {
      // home
      app.get('/', (req, res) => {
        res.render('index', {
          title: app.get('title')
        });
      });
      app.use('/:platform(cf|k8s|sm)', routes.broker);
    });
    HttpServer.start(internal);
    HttpServer.handleShutdown(); // https://github.com/nodejs/node-v0.x-archive/issues/5054
    UnlockResourcePoller.init();
  } catch (error) {
    logger.info('Process shutting down now because of error ', error);
    process.exit(CONST.ERR_CODES.UNCAUGHT_FATAL_EXCEPTION);
  }
}

init();
/* jshint ignore:end */
