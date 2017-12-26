'use strict';

console.log('Starting Service Fabrik Report App...');
const lib = require('./lib');
const routes = lib.routes;
const errors = require('./lib/errors');
const logger = lib.logger;
const HttpServer = require('./ServerUtil');
const FabrikApp = require('./FabrikApp');

const report = FabrikApp.createApp('report', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/report', routes.report);
});

HttpServer.startServer(report);
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