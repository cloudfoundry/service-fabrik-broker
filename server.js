'use strict';

console.log('Starting Service Fabrik...');
const lib = require('./lib');
const routes = lib.routes;
const errors = require('./lib/errors');
const logger = lib.logger;
const HttpServer = require('./HttpServer');
const FabrikApp = require('./FabrikApp');

lib.bootstrap();
const internal = FabrikApp.createApp('internal', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin', routes.admin);
  // cloud foundry service broker api
  app.use('/cf', routes.cf);
});

// exernal app
const external = FabrikApp.createApp('external', app => {
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

HttpServer.startServer(internal);
HttpServer.startServer(external);

process.on('SIGTERM', HttpServer.notifyShutDown);
process.on('SIGINT', HttpServer.notifyShutDown);
process.on('unhandledRejection', (reason, p) => {
  if (reason && reason instanceof errors.DBUnavailable) {
    logger.error('DB unavailable. shutting down app');
    HttpServer.notifyShutDown();
  } else {
    logger.error('Unhandled Rejection at:', p, 'reason:', reason);
  }
});

//https://github.com/nodejs/node-v0.x-archive/issues/5054
