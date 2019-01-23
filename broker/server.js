/* jshint ignore:start */
'use strict';

console.log('Starting Service Fabrik...');
const _ = require('lodash');
const lib = require('./lib');
const routes = require('../api-controllers/routes');
const HttpServer = require('../common/HttpServer');
const ExpressApp = require('../common/ExpressApp');
const config = require('../common/config');
const utils = require('../common/utils');

async function init() {
  // TODO- Move it to docker operator
  if (config.enable_swarm_manager) {
    lib.bootstrap();
  }

  await utils.registerInterOperatorCrds();
  // TODO:- To be removed when bosh services also push plan and service CRDs to apiserver
  await utils.pushServicePlanToApiServer();
  await lib.loadCatalogFromAPIServer();

  // internal app
  if (config.internal) {
    const internal = ExpressApp.create('internal', app => {
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
    HttpServer.start(internal);
  }
  // exernal app
  if (config.external) {
    const external = ExpressApp.create('external', app => {
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
    HttpServer.start(external);
  }
  HttpServer.handleShutdown(); //https://github.com/nodejs/node-v0.x-archive/issues/5054
  require('../common/UnlockResourcePoller');
}

init();
/* jshint ignore:end */