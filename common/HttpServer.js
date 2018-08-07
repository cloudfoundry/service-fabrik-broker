'use strict';

const http = require('http');
const https = require('https');
const pubsub = require('pubsub-js');
const CONST = require('./constants');
const logger = require('./logger');
const errors = require('./errors');

class HttpServer {
  static start(app) {
    const port = app.get('port');
    const title = app.get('title');
    const ssl = app.get('ssl');
    const type = app.get('type');
    const server = ssl ? https.createServer(ssl, app) : http.createServer(app);
    server.on('error', onerror);
    server.on('listening', onlistening);
    server.listen(port);

    function onerror(err) {
      logger.error(`${title}: Error occurred. Server will stop - `, err);
      if (err.syscall !== 'listen') {
        throw err;
      }
      switch (err.code) {
      case 'EACCES':
        logger.error(`${title}: Port ${port} requires elevated privileges`);
        process.exit(1);
        break;
      case 'EADDRINUSE':
        logger.error(`${title}: Port ${port} is already in use`);
        process.exit(1);
        break;
      default:
        throw err;
      }
    }

    function onlistening() {
      logger.info(`${title}: successfully started listening on port ${port}`);
      pubsub.publish(CONST.TOPIC.APP_STARTUP, {
        type: type
      });
    }
  }

  static handleShutdown() {
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
  }

  static notifyShutDown() {
    logger.info('App shutting down shortly...');
    pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
    //Publish shutdown message to all & wait for 5 secs
    setTimeout(() => {
      logger.info('ServiceFabrik shutdown complete');
      process.exit(2);
    }, 500);
  }

  static immediateShutdown() {
    logger.info('App shutting down now.');
    pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
    process.exit(2);
  }
}
module.exports = HttpServer;
//https://github.com/nodejs/node-v0.x-archive/issues/5054