'use strict';

const http = require('http');
const https = require('https');
const _ = require('lodash');
const pubsub = require('pubsub-js');
console.log('Starting Service Fabrik...');
const lib = require('./lib');
const apps = require('./apps');
const CONST = require('./lib/constants');
const errors = require('./lib/errors');
const logger = lib.logger;
const config = lib.config;

lib.bootstrap();

// start http and https server
_.each(apps, startServer);


function startServer(app) {
  const port = app.get('port');
  const title = app.get('title');
  const ssl = app.get('ssl');
  const type = app.get('type');
  const server = ssl ? https.createServer(ssl, app) : http.createServer(app);
  server.on('error', onerror);
  server.on('listening', onlistening);
  server.listen(port);
  server.timeout = config.http_timeout;

  function onerror(err) {
    logger.error('Error occurred. Server will stop - ', err);
    if (err.syscall !== 'listen') {
      throw err;
    }
    switch (err.code) {
    case 'EACCES':
      logger.error('Port ' + port + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      logger.error('Port ' + port + ' is already in use');
      process.exit(1);
      break;
    default:
      throw err;
    }
  }

  function onlistening() {
    logger.info(`${title} successfully started listening on port ${port}`);
    pubsub.publish(CONST.TOPIC.APP_STARTUP, {
      type: type
    });
  }
}

function notifyShutDown() {
  logger.info('App shutting down shortly...');
  pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
  //Publish shutdown message to all & wait for 5 secs
  setTimeout(() => {
    logger.info('ServiceFabrik shutdown complete');
    process.exit(2);
  }, 500);
}

process.on('SIGTERM', notifyShutDown);
process.on('SIGINT', notifyShutDown);
process.on('unhandledRejection', (reason, p) => {
  if (reason && reason instanceof errors.DBUnavailable) {
    logger.error('DB unavailable. shutting down app');
    notifyShutDown();
  } else {
    logger.error('Unhandled Rejection at:', p, 'reason:', reason);
  }
});

//https://github.com/nodejs/node-v0.x-archive/issues/5054