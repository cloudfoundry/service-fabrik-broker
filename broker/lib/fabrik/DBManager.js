'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../../common/config');
const logger = require('../../../common/logger');
const catalog = require('../../../common/models/catalog');
const DirectorManager = require('./DirectorManager');
const bosh = require('../../../data-access-layer/bosh');
const utils = require('../../../common/utils');
const errors = require('../../../common/errors');
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const NotFound = errors.NotFound;
const CONST = require('../../../common/constants');
const dbConnectionManager = require('../db/DbConnectionManager');

/**
 * DB can be configured into ServiceFabrik by either providing the URL of already provisioned mongodb via 'config.mongodb.url'
 * or it can be configured to provision one of the mongodb from the catalog by specifying the plan id via 'config.mongodb.provision...'
 * Plan Id has precendence over URL config.
 * Implementation has support for both approaches for initial connection. However if backup/restore is to be supported then
 * the DB instance configured via URL, must have implemented agent APIs for backup/restore features.
 */

class DBManager {
  constructor() {
    this.dbInitialized = false;
    this.bindInfo = undefined;
    this.initialize();
  }

  initialize() {
    return Promise.try(() => {
        if (_.get(config, 'mongodb.provision.plan_id') === undefined && _.get(config, 'mongodb.url') === undefined) {
          logger.warn('Mongodb not configured. Either DB URL or Mongo Plan Id must be configured for enabling MongoDB usage with ServiceFabrik.', _.get(config, 'mongodb.url'));
          this.dbState = CONST.DB.STATE.NOT_CONFIGURED;
          return;
        }
        if (_.get(config, 'mongodb.provision.plan_id') !== undefined && _.get(config, 'mongodb.provision.network_index') === undefined) {
          logger.warn('Plan Id is defined. Must also define network segment index where mongodb is to be deployed, else DB create/update will fail');
        }
        this.dbState = CONST.DB.STATE.TB_INIT;
        this.director = bosh.director;
        if (_.get(config, 'mongodb.provision.plan_id') !== undefined) {
          logger.info(`ServiceFabrik configured to use mongo plan: ${config.mongodb.provision.plan_id}`);
          const plan = catalog.getPlan(config.mongodb.provision.plan_id);
          return DirectorManager
            .load(plan)
            .then(directorManager => {
              this.directorManager = directorManager;
              if (config.mongodb.deployment_name) {
                return this.initDbFromBindInfo();
                /**
                 *Could have automatically initiated create/update of DB deployment on start up when no binding/instance is found.
                 *However if broker goes HA then  on start only the master must provision / update the DB. Hence external hooks are
                 *provided for create / update, which can be suitably plugged in as part of post deployment hooks and targetted
                 *specfically to master node. At start up app only tries to bind an existing instance.
                 */
              } else {
                logger.error(`config.mongodb.deployment_name is undefined. Deployment name must be defined for initializing DB Manager`);
                this.dbState = CONST.DB.STATE.NOT_CONFIGURED;
              }
            });
        } else {
          logger.info(`Connecting to DB with the provided config URL : ${config.mongodb.url}`);
          return this.initDb(config.mongodb);
        }
      }) //On deterministic error, just log message and stop
      .catch(ServiceBindingNotFound, (err) => logger.warn('MongoDB binding to ServiceFabrik not found. This generally should not occur. More Info:', err))
      .catch(err => {
        logger.error('Error occurred while initializing DB ...', err);
        logger.info(`Will attempt to reinitalize DB Manager after ${config.mongodb.retry_connect.min_delay} (ms)`);
        //Keep on trying till you can connect to DB for any other errors
        setTimeout(() => this.initialize(), config.mongodb.retry_connect.min_delay);
      });
  }

  initDbFromBindInfo() {
    return Promise.try(() => {
      if (this.dbInitialized) {
        //While an error during startup keeps retrying, the DB update operation in mean time could succeed in intializing DB.
        //This ensures we dont unnecessarily reinitialize again.
        return;
      }
      return this.getDbBindInfo()
        .then(bindInfo => {
          this.bindInfo = bindInfo;
          logger.info(`Bind Info retrieved - Connecting to :username:${bindInfo.credentials.username} - DB : ${bindInfo.credentials.dbname} - replicaSet : ${bindInfo.credentials.replicaset}`);
          return this.initDb(
            _.assign({}, config.mongodb, {
              url: bindInfo.credentials.uri
            }));
        });
    });
  }

  getDbBindInfo() {
    return Promise.try(() => {
      if (this.bindInfo) {
        return this.bindInfo;
      }
      return utils
        .retry(() => this
          .directorManager
          .getBindingProperty(config.mongodb.deployment_name, CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID), {
            maxAttempts: 5,
            minDelay: 5000,
            predicate: (err) => !(err instanceof ServiceBindingNotFound)
          });
    });
  }

  initDb(config) {
    logger.info('Connecting to db ...');
    this.dbState = CONST.DB.STATE.CONNECTING;
    this.dbUrl = config.url;
    return utils
      .retry(() => dbConnectionManager
        .startUp(config), {
          maxAttempts: 5,
          minDelay: 5000
        })
      .then(() => this.dbInitialized = true)
      .catch((err) => {
        this.dbState = CONST.DB.STATE.CONNECTION_FAILED;
        throw err;
      });
  }

  createOrUpdateDbDeployment(createIfNotPresent) {
    return Promise.try(() => {
      this.dbInitialized = false;
      const operation = createIfNotPresent ? 'Create' : 'Update';
      if (_.get(config, 'mongodb.deployment_name') === undefined ||
        _.get(config, 'mongodb.provision.plan_id') === undefined) {
        this.dbState = CONST.DB.STATE.NOT_CONFIGURED;
        logger.error('Cannot provision the Database as mongodb.provision.plan_id & mongodb.deployment_name must be configured');
        throw new errors.PreconditionFailed('Cannot provision the Database as mongodb.provision.plan_id & mongodb.deployment_name must be configured');
      }
      logger.info(`DB ${operation} initiated for:${config.mongodb.deployment_name} > plan: ${config.mongodb.provision.plan_id}`);
      return this.director
        .getDeployment(config.mongodb.deployment_name)
        .then((deployment) => {
          logger.info(`MongoDB deployment - ${JSON.stringify(deployment)}`);
          if (createIfNotPresent) {
            logger.error(`Trying to create exisiting ${config.mongodb.deployment_name} once again. Run deployment with mongodb.update flag instead of create flag`);
            //DB already exists. Ignore the create request
            throw new errors.BadRequest('MongoDB already exists. Use update instead of create operation');
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
            this.dbState = CONST.DB.STATE.CREATE_UPDATE_FAILED;
            throw err;
          }
        });
    });
  }

  dbCreateUpdate(createIfNotPresent) {
    return Promise.try(() => {
      let params;
      this.dbState = CONST.DB.STATE.CREATE_UPDATE_IN_PROGRESS;
      const context = {
        platform: 'service-fabrik',
        organization_guid: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
        space_guid: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID
      };
      const operation = createIfNotPresent ? 'Create' : 'Update';
      if (createIfNotPresent) {
        logger.warn('createIfNotPresent flag is set to true. Ensure this is happening only in the first deployment.');
        // MongoDB update operations should go through to BOSH without any rate limits applied by broker
        params = {
          context: context,
          organization_guid: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
          space_guid: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID,
          parameters: {
            _runImmediately: true
          }
        };
      } else {
        params = {
          context: context,
          previous_values: {
            plan_id: config.mongodb.provision.plan_id,
            organization_id: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
            space_id: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID
          },
          parameters: {
            _runImmediately: true
          }
        };
        logger.info('Updating DB Deployment...');
      }
      if (config.mongodb.provision.network_index === undefined) {
        logger.error(`mongodb.provision.network_index is undefined in mongodb configuration. Mongodb ${operation} cannot continue`);
        throw new errors.PreconditionFailed('mongodb.provision.network_index is undefined for mongodb deployment');
      }
      params.network_index = config.mongodb.provision.network_index;
      params.skip_addons = true;
      return this.directorManager.createOrUpdateDeployment(config.mongodb.deployment_name, params)
        .tap(out => {
          const taskId = out.task_id;
          logger.info(`MongoDB ${operation} request is complete. Check status for task id - ${taskId}`);
          this.director
            .pollTaskStatusTillComplete(taskId)
            .then(response => this.dbCreateUpdateSucceeded(response, createIfNotPresent))
            .catch(err => this.dbCreateUpdateFailed(err, operation));
        })
        .catch(err => this.dbCreateUpdateFailed(err, operation));
    });
  }

  dbCreateUpdateSucceeded(response, createIfNotPresent) {
    this.dbState = CONST.DB.STATE.CREATE_UPDATE_SUCCEEDED;
    const operation = createIfNotPresent ? 'Create' : 'Update';
    logger.info(`MongoDB ${operation}d successfully. Task Response: ${JSON.stringify(response)}`);
    this.dbState = CONST.DB.STATE.BIND_IN_PROGRESS;
    return this
      .getDbBindInfo()
      .then(() => this.initialize())
      .catch(ServiceBindingNotFound, () => {
        return this
          .directorManager
          .createBinding(config.mongodb.deployment_name, {
            id: CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID,
            parameters: config.mongodb.provision.bind_params || {}
          }).then(credentials => {
            logger.info('MongoDB Bind successful.');
            this.bindInfo = {
              credentials: credentials
            };
            this.initialize();
          });
      })
      .catch((err) => {
        this.dbState = CONST.DB.STATE.BIND_FAILED;
        logger.error(`+->Error occurred while initializing DB post successful ${operation}- `, err);
        //This block of code could be reached due to Bosh being down (either while getting binding or creating binding). So retry this operation.
        setTimeout(() => this.dbCreateUpdateSucceeded(response, createIfNotPresent), config.mongodb.retry_connect.min_delay);
      });
  }

  dbCreateUpdateFailed(err, operation) {
    this.dbState = CONST.DB.STATE.CREATE_UPDATE_FAILED;
    logger.error(`DB ${operation} failed. More info:`, err);
  }

  getState() {
    if (this.dbState !== CONST.DB.STATE.CREATE_UPDATE_IN_PROGRESS && this.dbState !== CONST.DB.STATE.CREATE_UPDATE_FAILED) {
      //If update is in progress, do not check status from connection manager. Create/Update status has highest precedence
      if (dbConnectionManager.getConnectionStatus() === CONST.DB.CONNECTION_STATE.CONNECTED) {
        this.dbState = CONST.DB.STATE.CONNECTED;
      } else if (dbConnectionManager.getConnectionStatus() === CONST.DB.CONNECTION_STATE.DISCONNECTED) {
        this.dbState = CONST.DB.STATE.DISCONNECTED;
      } else if (dbConnectionManager.getConnectionStatus() === CONST.DB.CONNECTION_STATE.SHUTTING_DOWN) {
        this.dbState = CONST.DB.STATE.SHUTTING_DOWN;
      }
    }
    return {
      status: this.dbState,
      url: this.dbUrl || ''
    };
  }
}

module.exports = DBManager;