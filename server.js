'use strict';

console.log('Starting Service Fabrik...');
const lib = require('./lib');
const routes = lib.routes;
const HttpServer = require('./HttpServer');
const FabrikApp = require('./FabrikApp');
const config = lib.config;

if (config.enable_swarm_manager) {
  lib.bootstrap();
}
const internal = FabrikApp.create('internal', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin', routes.admin);
  // cloud foundry service broker api
  app.use('/:platform(cf|k8s)', routes.broker);
});

// exernal app
const external = FabrikApp.create('external', app => {
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

HttpServer.start(internal);
HttpServer.start(external);
HttpServer.handleShutdown();

//https://github.com/nodejs/node-v0.x-archive/issues/5054