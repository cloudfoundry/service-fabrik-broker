'use strict';

const mongoose = require('mongoose');
const Promise = require('bluebird');
const pubsub = require('pubsub-js');
const logger = require('../../../common/logger');
const CONST = require('../../../common/constants');
const utils = require('../utils');
const errors = require('../../../common/errors');
mongoose.Promise = Promise;
const CONNECTION_STATE = CONST.DB.CONNECTION_STATE;

class DbConnectionManager {
  constructor() {
    pubsub.subscribe(CONST.TOPIC.MONGO_SHUTDOWN, () => this.shutDown('DB shutdown topic recieved..'));
    this.dbConnectionStatus = CONNECTION_STATE.WAIT_FOR_START;
    this.reconnectMode = false;
  }

  getConnectionStatus() {
    return this.dbConnectionStatus;
  }

  startUp(config) {
    try {
      if (this.reconnectMode) {
        logger.info('attempting to reconnect back to db');
      }
      const connection = mongoose
        .connect(config.url)
        .catch(err => {
          logger.error('Error connecting to mongo ->', err);
          this.dbConnectionStatus = CONNECTION_STATE.DISCONNECTED;
          return this.reconnect(config, err);
        });
      // Initialize schemas & define models
      require('./JobDetailSchema');
      require('./JobRunDetailSchema');
      require('./MaintenanceDetailSchema');
      require('./EventDetailSchema');
      logger.debug('Completed loading of mongoose Schemas');
      mongoose.connection.on('connected', () => {
        logger.info('Successfully connected to MongoDB');
        this.reconnectMode = false;
        this.dbConnectionStatus = CONNECTION_STATE.CONNECTED;
        pubsub.publish(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongoose,
          config: config
        });
        pubsub.subscribe(CONST.TOPIC.APP_SHUTTING_DOWN, () => this.shutDown('App Shutdown'));
      });
      mongoose.connection.on('error', (err) => {
        logger.error('Mongoose connection error: ' + err);
        if (this.dbConnectionStatus !== CONNECTION_STATE.SHUTTING_DOWN) {
          this.dbConnectionStatus = CONNECTION_STATE.DISCONNECTED;
          return this.reconnect(config, err);
        }
      });
      mongoose.connection.on('disconnected', () => {
        logger.error('Mongoose connection disconnected');
        if (this.dbConnectionStatus !== CONNECTION_STATE.SHUTTING_DOWN) {
          this.dbConnectionStatus = CONNECTION_STATE.DISCONNECTED;
          return this.reconnect(config);
        }
      });
      return connection;
    } catch (err) {
      logger.error('Error occurred while initializing mongo :=', err);
      return this.reconnect(config, err);
    }
  }

  shutDown(info) {
    if (this.dbConnectionStatus === CONNECTION_STATE.CONNECTED) {
      logger.info('DB going to shutdown. Reason : ', info);
      this.dbConnectionStatus = CONNECTION_STATE.SHUTTING_DOWN;
      return mongoose
        .connection
        .close(() => {
          logger.info('Mongoose connection closed');
        });
    }
  }

  reconnect(config, err) {
    return Promise.try(() => {
      logger.info('DB State :==>', this.dbConnectionStatus);
      if (!this.reconnectMode && this.dbConnectionStatus !== CONNECTION_STATE.SHUTTING_DOWN) {
        if (config.retry_connect) {
          this.reconnectMode = true;
          logger.info('Attempting reconnect to db with params:', config.retry_connect);
          return utils
            .retry(() => this.startUp(config), {
              maxAttempts: config.retry_connect.max_attempt,
              minDelay: config.retry_connect.min_delay
            })
            .catch(err => {
              pubsub.publish(CONST.TOPIC.MONGO_INIT_FAILED);
              logger.error('All attempts to reconnect to DB failed.', err);
              throw new errors.DBUnavailable(`DB Down / not reachable. Attempted to connect to db ${config.retry_connect.max_attempt} times. Code: ${err.code} , Message: ${err.message}`);
            });
        }
      } else if (err) {
        throw err;
      }
    });
  }
}

module.exports = new DbConnectionManager();