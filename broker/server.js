/* jshint ignore:start */
'use strict';

console.log('Starting Service Fabrik...');
const _ = require('lodash');
const routes = require('../api-controllers/routes');
const HttpServer = require('../common/HttpServer');
const ExpressApp = require('../common/ExpressApp');
const config = require('../common/config');
const utils = require('../common/utils');
const logger = require('../common/logger');
const CONST = require('../common/constants');

async function init() {
  try {
    let internal, external;
    // internal app
    if (config.internal) {
      internal = ExpressApp.create('internal', app => {
        // home
        app.get('/', (req, res) => {
          res.render('index', {
            title: app.get('title')
          });
        });
        if (!_.includes(config.disabled_apis, 'admin')) {
          app.use('/admin', routes.admin);
        }
        // cloud foundry service broker api
        if (!_.includes(config.disabled_apis, 'broker')) {
          app.use('/:platform(cf|k8s|sm)', routes.broker);
        }
      });
    }
    // exernal app
    if (config.external) {
      external = ExpressApp.create('external', app => {
        // home
        app.get('/', (req, res) => {
          res.render('index', {
            title: app.get('title')
          });
        });
        // service fabrik api
        app.use('/api', routes.api);
        // manage
        app.use('/manage', routes.manage);
      });
    }
    // Don't change the order of calling these methods,
    // As these are sync methods and take significant time
    // These should be executed only after all apps are set up
    // Else it breaks the pubsub mechanism of event login 
    // This is a temporary solution
    // Permanent solution would be to avoid unnecessary initialisation of modules in require

    await utils.registerInterOperatorCrds();
    // TODO:- To be removed when bosh services also push plan and service CRDs to apiserver
    await utils.pushServicePlanToApiServer();
    await utils.loadCatalogFromAPIServer();
    if(config.internal) {
      HttpServer.start(internal);
    }
    if(config.external) {
      HttpServer.start(external);
    }
    HttpServer.handleShutdown(); // https://github.com/nodejs/node-v0.x-archive/issues/5054
    require('../common/UnlockResourcePoller');
  } catch (error) {
    logger.info('Process shutting down now because of error ', error);
    process.exit(CONST.ERR_CODES.UNCAUGHT_FATAL_EXCEPTION);
  }
}

init();
/* jshint ignore:end */
