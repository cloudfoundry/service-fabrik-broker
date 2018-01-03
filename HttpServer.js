'use strict';

const http = require('http');
const https = require('https');
const pubsub = require('pubsub-js');
const lib = require('./lib');
const CONST = require('./lib/constants');
const logger = lib.logger;

class HttpServer {
  static startServer(app) {
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

  static notifyShutDown() {
    logger.info('App shutting down shortly...');
    pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
    //Publish shutdown message to all & wait for 5 secs
    setTimeout(() => {
      logger.info('ServiceFabrik shutdown complete');
      process.exit(2);
    }, 500);
  }
}
module.exports = HttpServer;
//https://github.com/nodejs/node-v0.x-archive/issues/5054