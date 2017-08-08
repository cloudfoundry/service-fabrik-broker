'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../config');
const logger = require('../logger');
const backupStore = require('../iaas').backupStore;
const Agent = require('./Agent');
const catalog = require('../models/catalog');
const DirectorManager = require('./DirectorManager');
const bosh = require('../bosh');
const errors = require('../errors');
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const NotFound = errors.NotFound;
const CONST = require('../constants');
const dbConnectionManager = require('../db/DbConnectionManager');


const DB_STATES = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  TB_INIT: 'TO_BE_INITIALIZED',
  INIT_FAILED: 'INIT_FAILED',
  CREATE_UPDATE_IN_PROGRESS: 'CREATE_UPDATE_IN_PROGRESS',
  CREATE_UPDATE_SUCCEEDED: 'CREATE_UPDATE_SUCCEEDED',
  BIND_IN_PROGRESS: 'BIND_IN_PROGRESS',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  CREATE_UPDATE_FAILED: 'CREATE_UPDATE_FAILED',
  BIND_FAILED: 'BIND_FAILED',
  SHUTTING_DOWN: 'SHUTTING_DOWN'
};

/**
 * DB can be configured into ServiceFabrik by either providing the URL of already provisioned mongodb via 'config.mongodb.url'
 * or it can be configured to provision one of the mongodb from the catalog by specifying the plan id via 'config.mongodb.provision...'
 * Plan Id has precendence over URL config.
 * Implementation has support for both approaches for initial connection. However if backup/restore is to be supported then
 * the DB instance configured via URL, must have implemented agent APIs for backup/restore features.
 */

class DBManager {
  constructor() {
    Promise.try(() => {
      if (config.mongodb === undefined) {
        this.dbState = DB_STATES.NOT_CONFIGURED;
        return;
      }
      this.dbState = DB_STATES.TB_INIT;
      this.director = bosh.director;
      this.backupStore = backupStore;
      if (config.mongodb.agent === undefined) {
        logger.error('config.mongodb.agent not defined. Backup/Restore for service-fabrik internal mongodb will not be supported!');
      } else {
        this.agent = new Agent(config.mongodb.agent);
      }
      if (_.get(config, 'mongodb.provision.plan_id') !== undefined) {
        logger.info(`ServiceFabrik configured to use mongo plan: ${config.mongodb.provision.plan_id}`);
        const plan = catalog.getPlan(config.mongodb.provision.plan_id);
        DirectorManager.load(plan)
          .then(directorManager => {
            this.directorManager = directorManager;
            if (config.mongodb.deployment_name) {
              this.directorManager
                .getBindingProperty(config.mongodb.deployment_name, CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID)
                .then(bindInfo => {
                  this.dbCredentials = bindInfo.credentials;
                  const connectParams = `username:${this.dbCredentials.username} - IPs @[10.11.252.20:27017,10.11.252.21:27017,10.11.252.22:27017]- DB : ${this.dbCredentials.dbname} - replicaSet : ${this.dbCredentials.replicaset}`;
                  logger.info(`Bind Info retrieved - Connecting to : ${connectParams}`);
                  return bindInfo.credentials.uri && this.initDb(_.assign({}, config.mongodb, {
                    url: this.dbCredentials.uri
                  }));
                }).catch(ServiceBindingNotFound, (err) => logger.warn('MongoDB binding to ServiceFabrik not found. This generally should not occur. More Info:', err));
              /**
               *Could have automatically initiated create/update of DB deployment on start up when no binding/instance is found.
               *However if broker goes HA then  on start only the master must provision / update the DB. Hence external hooks are
               *provided for create / update, which can be suitably plugged in as part of post deployment hooks and targetted
               *specfically to master node. At start up app only tries to bind an existing instance.
               */
            } else {
              logger.error(`mongodb property - config.mongodb.deployment_name is undefined. Deployment name must be defined.`);
              this.dbState = DB_STATES.NOT_CONFIGURED;
            }
          });
      } else if (config.mongodb.url) {
        logger.info(`Connecting to DB with the provided config URL : ${config.mongodb.url}`);
        this.initDb(config.mongodb);
      } else {
        logger.warn('Either DB URL or Mongo Plan Id must be configured for enabling DB usage with ServiceFabrik');
        this.dbState = DB_STATES.NOT_CONFIGURED;
      }
    }).catch(err => {
      logger.error('error occurred while initializing DBManager. More info:', err);
      this.dbState = DB_STATES.INIT_FAILED;
    });
  }

  initDb(config) {
    logger.info('Starting up db ...');
    this.dbState = DB_STATES.CONNECTING;
    this.dbUrl = config.url;
    return dbConnectionManager
      .startUp(config)
      .catch(() => this.dbState = DB_STATES.CONNECTION_FAILED);
  }

  createOrUpdateDbDeployment(createIfNotPresent) {
    return Promise.try(() => {
      if (_.get(config, 'mongodb.deployment_name') === undefined ||
        _.get(config, 'mongodb.provision.plan_id') === undefined) {
        this.dbState = DB_STATES.NOT_CONFIGURED;
        logger.error('Cannot provision the Database as mongodb.provision.plan_id & mongodb.deployment_name must be configured');
        return;
      }
      logger.info(`DB Create/Update initiated for:${config.mongodb.deployment_name} > plan: ${config.mongodb.provision.plan_id}`);
      return this.director
        .getDeployment(config.mongodb.deployment_name)
        .then((deployment) => {
          logger.info(`deployment - ${JSON.stringify(deployment)}`);
          if (createIfNotPresent) {
            logger.error(`Trying to create exisiting ${config.mongodb.deployment_name} once again. Run deployment with mongodb.update flag instead of create flag`);
            //DB already exists. Ignore the create request
            return;
          }
          return this.dbCreateUpdate(createIfNotPresent);
        })
        .catch(NotFound, err => {
          //Explicit check to first retrieve DB Deployment. In production, only once in Fabrik's lifetime DB is to be provisioined.
          //Post initial deployment 'createIfNotPresent' should always be false. Accidental db deployment deletes should not lead
          //to recreation rather they must be flagged as errors.
          if (createIfNotPresent) {
            logger.warn(`${config.mongodb.deployment_name} deployment not found. DB will be getting provisioned.`);
            return this.dbCreateUpdate(createIfNotPresent);
          } else {
            logger.error(`${config.mongodb.deployment_name} - deployment not found. DB Update Failed.`, err);
            this.dbState = DB_STATES.CREATE_UPDATE_FAILED;
            throw err;
          }
        });
    });
  }

  dbCreateUpdate(createIfNotPresent) {
    let params;
    this.dbState = DB_STATES.CREATE_UPDATE_IN_PROGRESS;
    if (createIfNotPresent) {
      logger.warn('createIfNotPresent flag is set to true. Ensure this is happening only in the first deployment.');
      params = {
        organization_guid: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
        space_guid: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID,
      };
    } else {
      params = {
        previous_values: {
          organization_id: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
          space_id: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID
        }
      };
      logger.info('Updating DB Deployment...');
    }
    if (config.mongodb.provision.network_index === undefined) {
      throw new errors.PreconditionFailed('mongodb.provision.network_index is undefined for mongodb deployment');
    }
    params.network_index = config.mongodb.provision.network_index;
    return this.directorManager.createOrUpdateDeployment(config.mongodb.deployment_name, params)
      .tap(taskId => {
        logger.info(`Create/update operation is complete. Check status for task - ${taskId}`);
        this.director
          .pollTaskStatusTillComplete(taskId)
          .then(response => this.dbCreateUpdateSucceeded(response))
          .catch(err => this.dbCreateUpdateFailed(err));
      })
      .catch(Error, err => {
        logger.error('Error occurred while create/update deployment. More info :', err);
        this.dbState = DB_STATES.CREATE_UPDATE_FAILED;
      });
  }

  dbCreateUpdateSucceeded() {
    this.dbState = DB_STATES.CREATE_UPDATE_SUCCEEDED;
    if (this.dbUrl) {
      logger.info(`DB Update Succeeded. DB Url : ${this.dbUrl}`);
      return this.initDb({
        url: this.dbUrl
      });
    }
    logger.info(`MongoDB Provisioned successfully. Will initiate bind...`);
    this.dbState = DB_STATES.BIND_IN_PROGRESS;
    return this.directorManager.createBinding(config.mongodb.deployment_name, {
        id: CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID,
        parameters: config.mongodb.provision.bind_params || {}
      }).then(credentials => {
        logger.info('MongoDB Bind successful.');
        this.dbCredentials = credentials;
        const connectParams = `username:${this.dbCredentials.username} - IPs @[10.11.252.20:27017,10.11.252.21:27017,10.11.252.22:27017]- DB : {this.dbCredentials.dbname} - replicaSet : ${this.dbCredentials.replicaset}`;
        logger.info('Connecting to DB @:', connectParams);
        return credentials.uri && this.initDb({
          url: credentials.uri
        });
      })
      .catch(err => {
        this.dbState = DB_STATES.BIND_FAILED;
        logger.error('error occurred while binding to fabrik mongodb. More info:', err);
      });
  }

  dbCreateUpdateFailed(err) {
    this.dbState = DB_STATES.CREATE_UPDATE_FAILED;
    logger.error('DB Create/Update failed. More info:', err);
  }

  getState() {
    if (this.dbState !== DB_STATES.CREATE_UPDATE_IN_PROGRESS) {
      //If update is in progress, do not check status from connection manager. Create/Update status has highest precedence
      if (dbConnectionManager.getConnectionStatus() === CONST.DB.CONNECTION_STATE.CONNECTED) {
        this.dbState = DB_STATES.CONNECTED;
      } else if (dbConnectionManager.getConnectionStatus() === CONST.DB.CONNECTION_STATE.DISCONNECTED) {
        this.dbState = DB_STATES.DISCONNECTED;
      } else if (dbConnectionManager.getConnectionStatus() === CONST.DB.CONNECTION_STATE.SHUTTING_DOWN) {
        this.dbState = DB_STATES.SHUTTING_DOWN;
      }
    }
    return {
      status: this.dbState,
      url: this.dbUrl || ''
    };
  }

}

module.exports = DBManager;