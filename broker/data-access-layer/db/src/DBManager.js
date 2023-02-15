'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('@sf/app-config');
const logger = require('@sf/logger');
const { catalog } = require('@sf/models');
const bosh = require('@sf/bosh');
const {
  CONST,
  errors: {
    Timeout,
    NotFound,
    PageNotFound,
    BadRequest,
    PreconditionFailed
  },
  commonFunctions
} = require('@sf/common-utils');
const {
  decodeBase64,
  encodeBase64
} = commonFunctions;
const { apiServerClient } = require('@sf/eventmesh');
const { BasePlatformManager } = require('@sf/platforms');
const DirectorService = require('@sf/provisioner-services').DirectorService;
const dbConnectionManager = require('./DbConnectionManager');

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
    this.dbState = CONST.DB.STATE.TB_INIT;
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
      this.director = bosh.director;
      if (_.get(config, 'mongodb.provision.plan_id') !== undefined) {
        logger.info(`ServiceFabrik configured to use mongo plan: ${config.mongodb.provision.plan_id}`);
        const plan = catalog.getPlan(config.mongodb.provision.plan_id);
        return Promise
          .try(() => new DirectorService(plan))
          .then(directorService => {
            directorService.assignPlatformManager(new BasePlatformManager());
            this.directorService = directorService;
            if (config.mongodb.deployment_name) {
              return this.initDbFromBindInfo();
              /**
                 *Could have automatically initiated create/update of DB deployment on start up when no binding/instance is found.
                 *However if broker goes HA then  on start only the master must provision / update the DB. Hence external hooks are
                 *provided for create / update, which can be suitably plugged in as part of post deployment hooks and targetted
                 *specfically to master node. At start up app only tries to bind an existing instance.
                 */
            } else {
              logger.error('config.mongodb.deployment_name is undefined. Deployment name must be defined for initializing DB Manager');
              this.dbState = CONST.DB.STATE.NOT_CONFIGURED;
            }
          });
      } else {
        logger.info(`Connecting to DB with the provided config URL : ${config.mongodb.url}`);
        return this.initDb(config.mongodb);
      }
    })
      .catch(err => {
        logger.error('Error occurred while initializing DB ...', err);
        logger.info(`Will attempt to reinitalize DB Manager after ${config.mongodb.retry_connect.min_delay} (ms)`);
        // Keep on trying till you can connect to DB for any other errors
        setTimeout(() => this.initialize(), config.mongodb.retry_connect.min_delay);
      });
  }

  initDbFromBindInfo() {
    return Promise.try(() => {
      if (this.dbInitialized) {
        // While an error during startup keeps retrying, the DB update operation in mean time could succeed in intializing DB.
        // This ensures we dont unnecessarily reinitialize again.
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
    function throwTimeoutError(err) {
      throw err.error;
    }
    return Promise.try(() => {
      return commonFunctions.retry(tries => {
        logger.debug(`+-> Attempt ${tries + 1} to get db binding from apiserver`);
        return apiServerClient.getResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
          resourceId: _.toLower(CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID)
        });
      }, {
        maxAttempts: 3,
        minDelay: CONST.APISERVER.RETRY_DELAY,
        // Should not retry when err is NotFound, but should retry when err is PageNotFound
        predicate: err => !(err instanceof NotFound && !(err instanceof PageNotFound))
      }) 
        .catch(Timeout, throwTimeoutError)
        .then(resource => decodeBase64(_.get(resource, 'status.response')));
    });
  }

  initDb(config) {
    logger.info('Connecting to db ...');
    this.dbState = CONST.DB.STATE.CONNECTING;
    this.dbUrl = config.url;
    return commonFunctions.retry(() => dbConnectionManager
      .startUp(config), {
      maxAttempts: 5,
      minDelay: 5000
    })
      .then(() => this.dbInitialized = true)
      .catch(err => {
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
        throw new PreconditionFailed('Cannot provision the Database as mongodb.provision.plan_id & mongodb.deployment_name must be configured');
      }
      logger.info(`DB ${operation} initiated for:${config.mongodb.deployment_name} > plan: ${config.mongodb.provision.plan_id}`);
      return this.director
        .getDeployment(config.mongodb.deployment_name)
        .then(deployment => {
          logger.info(`MongoDB deployment - ${JSON.stringify(deployment)}`);
          if (createIfNotPresent) {
            logger.error(`Trying to create exisiting ${config.mongodb.deployment_name} once again. Run deployment with mongodb.update flag instead of create flag`);
            // DB already exists. Ignore the create request
            throw new BadRequest('MongoDB already exists. Use update instead of create operation');
          }
          return this.dbCreateUpdate(createIfNotPresent);
        })
        .catch(NotFound, err => {
          // Explicit check to first retrieve DB Deployment. In production, only once in Fabrik's lifetime DB is to be provisioined.
          // Post initial deployment 'createIfNotPresent' should always be false. Accidental db deployment deletes should not lead
          // to recreation rather they must be flagged as errors.
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
          service_id: CONST.FABRIK_INTERNAL_MONGO_DB.SERVICE_ID,
          organization_guid: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
          space_guid: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID,
          parameters: {
            _runImmediately: true
          }
        };
      } else {
        params = {
          context: context,
          service_id: CONST.FABRIK_INTERNAL_MONGO_DB.SERVICE_ID,
          previous_values: {
            plan_id: (config.mongodb.provision.previous_plan_id === undefined ? config.mongodb.provision.plan_id : config.mongodb.provision.previous_plan_id),
            organization_id: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
            space_id: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID
          },
          parameters: {
            _runImmediately: true
          }
        };
        logger.info('Updating DB Deployment...');
	logger.info(`previous plan id : ${config.mongodb.provision.previous_plan_id}`);
	logger.info(`Plan params... ${JSON.stringify(params)}`);
      }
      if (config.mongodb.provision.network_index === undefined) {
        logger.error(`mongodb.provision.network_index is undefined in mongodb configuration. Mongodb ${operation} cannot continue`);
        throw new PreconditionFailed('mongodb.provision.network_index is undefined for mongodb deployment');
      }
      params.network_index = config.mongodb.provision.network_index;
      params.skip_addons = true;
      return Promise.try(() => {
        if (createIfNotPresent) {
          this.bindInfo = undefined;
          return apiServerClient.deleteResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
            resourceId: _.toLower(CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID)
          })
            .catch(NotFound, () => {
              logger.info('Resource not present in ApiServer. Proceeding with create.');
            });
        }
      })
        .then(() => this.directorService.createOrUpdateDeployment(config.mongodb.deployment_name, params))
        .tap(out => {
          const taskId = _.get(out, 'task_id');
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
      .then(() => {
        this.dbState = CONST.DB.STATE.TB_INIT;
        return this.initialize();
      })
      .catch(NotFound, () => {
        return this
          .directorService
          .createBinding(config.mongodb.deployment_name, {
            id: CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID,
            parameters: config.mongodb.provision.bind_params || {}
          }).then(credentials => {
            logger.info('MongoDB Bind successful.');
            this.bindInfo = {
              credentials: credentials
            };
            return commonFunctions.retry(() => this.storeBindPropertyOnApiServer({
              id: _.toLower(CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID),
              parameters: config.mongodb.provision.bind_params || {},
              credentials: credentials
            }), {
              maxAttempts: 5,
              minDelay: 5000
            });
          })
          .then(() => {
            this.dbState = CONST.DB.STATE.TB_INIT;
            return this.initialize();
          });
      })
      .catch(err => {
        this.dbState = CONST.DB.STATE.BIND_FAILED;
        logger.error(`+->Error occurred while initializing DB post successful ${operation}- `, err);
        // This block of code could be reached due to Bosh being down (either while getting binding or creating binding). So retry this operation.
        setTimeout(() => this.dbCreateUpdateSucceeded(response, createIfNotPresent), config.mongodb.retry_connect.min_delay);
      });
  }

  storeBindPropertyOnApiServer(bindProperty) {
    let encodedBindProperty = encodeBase64(bindProperty);
    return apiServerClient.createResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
      resourceId: bindProperty.id,
      options: {
        binding_id: bindProperty.id
      },
      status: {
        state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED,
        response: encodedBindProperty
      }
    });
  }

  dbCreateUpdateFailed(err, operation) {
    this.dbState = CONST.DB.STATE.CREATE_UPDATE_FAILED;
    logger.error(`DB ${operation} failed. More info:`, err);
  }

  getState() {
    if (this.dbState !== CONST.DB.STATE.CREATE_UPDATE_IN_PROGRESS && this.dbState !== CONST.DB.STATE.CREATE_UPDATE_FAILED) {
      // If update is in progress, do not check status from connection manager. Create/Update status has highest precedence
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
