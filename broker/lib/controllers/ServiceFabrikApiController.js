'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const jwt = require('../jwt');
const logger = require('../logger');
const backupStore = require('../iaas').backupStore;
const filename = backupStore.filename;
const eventmesh = require('../../../eventmesh');
const lockManager = eventmesh.lockManager;
const errors = require('../errors');
const FabrikBaseController = require('./FabrikBaseController');
const Unauthorized = errors.Unauthorized;
const NotFound = errors.NotFound;
const Timeout = errors.Timeout;
const cf = require('../cf')
const Forbidden = errors.Forbidden;
const BadRequest = errors.BadRequest;
const Conflict = errors.Conflict;
const UnprocessableEntity = errors.UnprocessableEntity;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const JsonWebTokenError = jwt.JsonWebTokenError;
const ContinueWithNext = errors.ContinueWithNext;
const InternalServerError = errors.InternalServerError;
const EtcdLockError = errors.EtcdLockError;
const ScheduleManager = require('../jobs');
const config = require('../config');
const CONST = require('../constants');
const catalog = require('../models').catalog;
const utils = require('../utils');
const docker = config.enable_swarm_manager ? require('../docker') : undefined;

const CloudControllerError = {
  NotAuthorized: err => {
    const body = err.error;
    return err.statusCode === CONST.HTTP_STATUS_CODE.FORBIDDEN && (
      body.code === 10003 || body.error_code === 'CF-NotAuthorized'
    );
  }
};


class ServiceFabrikApiController extends FabrikBaseController {
  constructor() {
    super();
  }

  /**
   * @param {object} opts - Object containing options
   * @param {string} opts.resourceId - instance_guid
   * @param {string} opts.operationId - Id of the operation ex. backupGuid
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   */
  static getResourceOperationStatus(opts) {
    logger.info(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => eventmesh.server.getOperationState({
        resourceId: opts.resourceId,
        operationName: CONST.OPERATION_TYPE.BACKUP,
        operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
        operationId: opts.operationId
      })).then(state => {
        const duration = (new Date() - opts.started_at) / 1000;
        logger.info(`Polling for ${opts.start_state} duration: ${duration} `);
        if (duration > CONST.BACKUP.BACKUP_START_TIMEOUT) {
          throw new Timeout(`Backup not picked up from queue`);
        }
        if (state === opts.start_state) {
          return ServiceFabrikApiController.getResourceOperationStatus(opts);
        } else if (state === CONST.APISERVER.RESOURCE_STATE.ERROR) {
          finalState = state;
          return eventmesh.server.getOperationResult({
            resourceId: opts.resourceId,
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
            operationId: opts.operationId,
          })
            .then(error => {
              let json = JSON.parse(error);
              logger.info('Operation manager reported error', json);
              let message = json.message;
              if (json.error && json.error.description) {
                message = `${message}. ${json.error.description}`;
              }
              let err;
              switch (json.status) {
                case CONST.HTTP_STATUS_CODE.BAD_REQUEST:
                  err = new BadRequest(message);
                  break;
                case CONST.HTTP_STATUS_CODE.NOT_FOUND:
                  err = new NotFound(message);
                  break;
                case CONST.HTTP_STATUS_CODE.CONFLICT:
                  err = new Conflict(message);
                  break;
                default:
                  err = new InternalServerError(message);
                  break;
              }
              throw err;
            });
        } else {
          finalState = state;
          return eventmesh.server.getOperationResult({
            resourceId: opts.resourceId,
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
            operationId: opts.operationId,
          });
        }
      })
      .then(result => {
        if (result.state) {
          return result;
        }
        let status = {};
        status.state = finalState;
        status.response = result;
        return status;
      });
  }

  verifyAccessToken(req, res) {
    /* jshint unused:false */
    function handleError(err) {
      throw new Unauthorized(err.message);
    }
    const scopes = [
      'cloud_controller.admin'
    ];
    const requiresAdminScope = this.getConfigPropertyValue('external.api_requires_admin_scope', false);
    switch (_.toUpper(req.method)) {
      case 'GET':
        scopes.push('cloud_controller.admin_read_only');
        if (!requiresAdminScope) {
          scopes.push(
            'cloud_controller.read',
            'cloud_controller_service_permissions.read'
          );
        }
        break;
      default:
        if (!requiresAdminScope) {
          scopes.push('cloud_controller.write');
        }
        break;
    }
    const [scheme, bearer] = _
      .chain(req)
      .get('headers.authorization')
      .split(' ')
      .value();
    return Promise
      .try(() => {
        if (!/^Bearer$/i.test(scheme)) {
          throw new Unauthorized('No access token was found');
        }
        req.auth = {
          bearer: bearer
        };
        return this.uaa.tokenKey();
      })
      .then(tokenKey => jwt.verify(bearer, tokenKey.value))
      .catch(JsonWebTokenError, handleError)
      .tap(token => {
        _.set(req, 'cloudControllerScopes', token.scope);
        if (_
          .chain(token.scope)
          .intersection(scopes)
          .isEmpty()
          .value()) {
          logger.error(`token scope : ${JSON.stringify(token)} - required scope : ${JSON.stringify(scopes)}`);
          throw new Forbidden('Token has insufficient scope');
        }
        req.user = {
          id: token.user_id,
          name: token.user_name,
          email: token.email
        };
      })
      .throw(new ContinueWithNext());
  }

  verifyTenantPermission(req, res) {
    /* jshint unused:false */
    const user = req.user;
    const opts = _.pick(req, 'auth');
    const httpMethod = _.toUpper(req.method);
    const insufficientPermissions = `User '${user.name}' has insufficient permissions`;
    let isCloudControllerAdmin = false;
    if (_.get(req, 'cloudControllerScopes').includes('cloud_controller.admin')) {
      isCloudControllerAdmin = true;
    }
    return Promise
      .try(() => {
        /* Following statement to address cross consumption scenario*/
        const platform = _.get(req, 'body.context.platform') || _.get(req, 'query.platform') || CONST.PLATFORM.CF;
        _.set(req, 'entity.platform', platform);

        /*Following statement for backward compatibility*/
        const tenantId = _.get(req, 'body.space_guid') || _.get(req, 'query.space_guid') ||
          _.get(req, 'query.tenant_id') || _.get(req, 'body.context.space_guid') || _.get(req, 'body.context.namespace');

        if (tenantId) {
          if ((platform === CONST.PLATFORM.CF && !FabrikBaseController.uuidPattern.test(tenantId)) ||
            (platform === CONST.PLATFORM.K8S && !FabrikBaseController.k8sNamespacePattern.test(tenantId))) {
            throw new BadRequest(`Invalid 'uuid' or 'name' '${tenantId}'`);
          }
          return tenantId;
        }
        const instanceId = req.params.instance_id;
        this.validateUuid(instanceId, 'Service Instance ID');
        /* TODO: Need to handle following in case of consumption from K8S  */
        return this.cloudController
          .getServiceInstance(instanceId)
          .tap(body => _.set(req, 'entity.name', body.entity.name))
          .then(body => body.entity.space_guid);
      })
      .tap(space_guid => _.set(req, 'entity.space_guid', space_guid))
      .tap(space_guid => _.set(req, 'entity.tenant_id', space_guid))
      .then(space_guid => {
        if (isCloudControllerAdmin) {
          return;
        }
        return this.cloudController
          .getSpaceDevelopers(space_guid, opts)
          .catchThrow(CloudControllerError.NotAuthorized, new Forbidden(insufficientPermissions));
      })
      .tap(developers => {
        if (isCloudControllerAdmin) {
          logger.info(`User ${user.email} has cloud_controller.admin scope. SpaceDeveloper validation will be skipped`);
          return;
        }
        const isSpaceDeveloper = _
          .chain(developers)
          .findIndex(developer => (developer.metadata.guid === user.id))
          .gte(0)
          .value();
        if (httpMethod !== 'GET' && !isSpaceDeveloper) {
          throw new Forbidden(insufficientPermissions);
        }
        logger.info('space develoopers done');
      })
      .catch(err => {
        logger.warn('Verification of user permissions failed');
        logger.warn(err);
        throw err;
      })
      .throw(new ContinueWithNext());
  }

  getInfo(req, res) {
    let allDockerImagesRetrieved = true;
    return Promise.try(() => {
      if (config.enable_swarm_manager) {
        return docker
          .getMissingImages()
          .then(missingImages => allDockerImagesRetrieved = _.isEmpty(missingImages));
      }
    })
      .catch(err => {
        allDockerImagesRetrieved = false;
        logger.info('error occurred while fetching docker images', err);
      })
      .finally(() => {
        res.status(CONST.HTTP_STATUS_CODE.OK)
          .json({
            name: this.serviceBrokerName,
            api_version: this.constructor.version,
            ready: allDockerImagesRetrieved,
            db_status: this.fabrik.dbManager.getState().status
          });
      });
  }

  getServiceInstanceState(req, res) {
    req.manager.verifyFeatureSupport('state');
    return req.manager
      .getServiceInstanceState(req.params.instance_id)
      .then(body => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(_.pick(body, 'operational', 'details'))
      );
  }

  checkQuota(req, trigger) {
    return Promise
      .try(() => {
        if (trigger === CONST.BACKUP.TRIGGER.SCHEDULED && req.user.name !== config.cf.username) {
          logger.error(`Permission denied. User : ${req.user.name} - cannot trigger scheduled backup`);
          throw new errors.Forbidden('Scheduled backups can only be initiated by the System User');
        } else if (trigger === CONST.BACKUP.TRIGGER.ON_DEMAND) {
          const options = {
            instance_id: req.params.instance_id,
            tenant_id: req.entity.tenant_id
          };
          return this.listBackupFiles(options)
            .then(backupList => {
              const onDemandBackups = _.filter(backupList, backup => backup.trigger === CONST.BACKUP.TRIGGER.ON_DEMAND);
              if (onDemandBackups.length >= config.backup.max_num_on_demand_backup) {
                throw new errors.Forbidden(`Reached max quota of ${config.backup.max_num_on_demand_backup} ${CONST.BACKUP.TRIGGER.ON_DEMAND} backups`);
              }
              return true;
            });
        }
      });
  }

  startBackup(req, res) {
    logger.info(`Service fabrik enabled: ${config.enable_service_fabrik_v2}`);
    if (config.enable_service_fabrik_v2) {
      return this.startBackup_sf20(req, res);
    }
    logger.info(`Calling service fabrik v1`);
    return this.startBackup_sf10(req, res);
  }

  startBackup_sf10(req, res) {
    req.manager.verifyFeatureSupport('backup');
    const trigger = _.get(req.body, 'trigger', CONST.BACKUP.TRIGGER.ON_DEMAND);
    return Promise
      .try(() => this.checkQuota(req, trigger))
      .then(() => {
        _.set(req.body, 'trigger', trigger);
        const bearer = _
          .chain(req.headers)
          .get('authorization')
          .split(' ')
          .nth(1)
          .value();
        return this.fabrik
          .createOperation('backup', {
            instance_id: req.params.instance_id,
            bearer: bearer,
            arguments: req.body,
            isOperationSync: true,
            username: req.user.name,
            useremail: req.user.email || ''
          })
          .invoke()
          .tap(response => logger.info('backup response ', response))
          .then(body => res
            .status(CONST.HTTP_STATUS_CODE.ACCEPTED)
            .send(body)
          );
      });
  }

  getBackupOptions(backup_guid, deployment, req) {
    return Promise
      .all([
        cf.cloudController.findServicePlanByInstanceId(req.params.instance_id),
        cf.cloudController.getOrgAndSpaceGuid(req.params.instance_id)
      ])
      .spread((plan_details, res) => {
        const context = req.body.context || {
          space_guid: res.space_guid,
          platform: 'cloudfoundry'
        };
        const backupOptions = {
          guid: backup_guid,
          deployment: deployment,
          instance_guid: req.params.instance_id,
          plan_id: req.body.plan_id || plan_details.entity.unique_id,
          service_id: req.body.service_id || this.getPlan(plan_details.entity.unique_id).service.id,
          context: context
        };
        return backupOptions
      });
  }

  startBackup_sf20(req, res) {
    let backup_started_at;
    let lockedDeployment = false; // Need not unlock if checkQuota fails for parallelly triggered on-demand backup
    req.manager.verifyFeatureSupport(CONST.OPERATION_TYPE.BACKUP);
    const trigger = _.get(req.body, 'trigger', CONST.BACKUP.TRIGGER.ON_DEMAND);
    let backupGuid;
    return Promise
      .try(() => this.checkQuota(req, trigger))
      .then(() => Promise.all([utils
        .uuidV4(),
      req.manager
        .findNetworkSegmentIndex(req.params.instance_id)
        .then(networkIndex => req.manager.getDeploymentName(req.params.instance_id, networkIndex))
      ]))
      .spread((guid, deployment) => {
        _.set(req.body, 'trigger', trigger);
        backupGuid = guid;
        return this.getBackupOptions(backupGuid, deployment, req)
          .then(backupOptions => {
            logger.info(`Triggering backup with options: ${backupOptions}`);
            // Acquire read lock for resource resourceId
            return lockManager.lock(req.params.instance_id, {
              lockType: CONST.ETCD.LOCK_TYPE.READ,
              lockedResourceDetails: {
                resourceType: CONST.APISERVER.RESOURCE_TYPES.BACKUP,
                resourceName: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
                resourceId: backupGuid,
                operation: CONST.OPERATION_TYPE.BACKUP
              }
            })
              .then(() => {
                lockedDeployment = true;
                return eventmesh.server.createOperationResource({
                  resourceId: req.params.instance_id,
                  operationName: CONST.OPERATION_TYPE.BACKUP,
                  operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
                  operationId: backupGuid,
                  val: backupOptions
                });
              });
          });
      })
      .then(() => {
        backup_started_at = new Date();
        //check if resource exist, else create and then update
        return Promise.try(() => eventmesh.server.getResource('deployment', 'directors', req.params.instance_id))
          .catch(() => eventmesh.server.createDeploymentResource(null, req.params.instance_id, {}))
          .then(() => eventmesh.server.updateLastOperation({
            resourceId: req.params.instance_id,
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
            value: backupGuid
          }))
          .then(() => ServiceFabrikApiController.getResourceOperationStatus({
            resourceId: req.params.instance_id,
            operationId: backupGuid,
            start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            started_at: backup_started_at
          }));
      })
      .tap(status => {
        logger.info(`Backup Response `, status.response);
        return req.manager
          .findNetworkSegmentIndex(req.params.instance_id)
          .then(networkIndex => {
            logger.error('NetworkIndex is ', req.params, networkIndex);
            return req.manager.getDeploymentName(req.params.instance_id, networkIndex);
          });
      })
      .then(status => {
        logger.info('Operation response:', status.response);
        const body = JSON.parse(status.response);
        res.status(CONST.HTTP_STATUS_CODE.ACCEPTED).send(body);
      })
      .catch(err => {
        logger.info('Handling error :', err);
        if (err instanceof EtcdLockError) {
          throw err;
        }
        if (lockedDeployment) {
          return lockManager.unlock(req.params.instance_id)
            .throw(err);
        }
        throw err;
      })
      .catch(Timeout, () => {
        return this.abortLastBackup(req, res);
      });
  }

  getLastBackup(req, res) {
    if (config.enable_service_fabrik_v2) {
      return this.getLastBackup20(req, res);
    }
    return this.getLastBackup10(req, res);
  }

  getLastBackup20(req, res) {
    return eventmesh.server.getLastOperation({
      resourceId: req.params.instance_id,
      operationName: CONST.OPERATION_TYPE.BACKUP,
      operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP
    })
      .then(backup_guid =>
        eventmesh.server.getOperationResult({
          operationName: CONST.OPERATION_TYPE.BACKUP,
          operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
          operationId: backup_guid,
        }))
      .then(result => {
        logger.info('Remove mme', result);
        return res
          .status(CONST.HTTP_STATUS_CODE.OK)
          .send(_.omit(JSON.parse(result), 'secret', 'agent_ip'))
      })
      .catchThrow(new NotFound(`No backup found for service instance '${req.params.instance_id}'`));
  }

  getLastBackup10(req, res) {
    req.manager.verifyFeatureSupport('backup');
    const instanceId = req.params.instance_id;
    const noCache = req.query.no_cache === 'true' ? true : false;
    const tenantId = req.entity.tenant_id;
    return req.manager
      .getLastBackup(tenantId, instanceId, noCache)
      .then(result => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(_.omit(result, 'secret', 'agent_ip'))
      )
      .catchThrow(NotFound, new NotFound(`No backup found for service instance '${instanceId}'`));
  }

  abortLastBackup(req, res) {
    if (config.enable_service_fabrik_v2) {
      return this.abortLastBackup20(req, res);
    }
    return this.abortLastBackup10(req, res);
  }

  abortLastBackup10(req, res) {
    req.manager.verifyFeatureSupport('backup');
    const instanceId = req.params.instance_id;
    const tenantId = req.entity.tenant_id;
    return req.manager
      .abortLastBackup(tenantId, instanceId)
      .then(result => res
        .status(result.state === 'aborting' ? CONST.HTTP_STATUS_CODE.ACCEPTED : CONST.HTTP_STATUS_CODE.OK)
        .send({})
      );
  }


  abortLastBackup20(req, res) {
    req.manager.verifyFeatureSupport('backup');
    const backup_started_at = new Date();
    return eventmesh.server.getLastOperation({
      resourceId: req.params.instance_id,
      operationName: CONST.OPERATION_TYPE.BACKUP,
      operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
    }).then(backupGuid => {
      return eventmesh.server.getOperationState({
        resourceId: req.params.instance_id,
        operationName: CONST.OPERATION_TYPE.BACKUP,
        operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
        operationId: backupGuid,
      }).then(state => {
        // abort only if the state is in progress
        if (state === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS) {
          return eventmesh.server.updateOperationState({
            resourceId: req.params.instance_id,
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_NAMES.DEFAULT_BACKUP,
            operationId: backupGuid,
            stateValue: CONST.OPERATION.ABORT
          });
        } else {
          logger.info(`Skipping abort as state is : ${state}`);
        }
      }).then(() => ServiceFabrikApiController.getResourceOperationStatus({
        resourceId: req.params.instance_id,
        operationId: backupGuid,
        start_state: CONST.OPERATION.ABORT,
        started_at: backup_started_at
      }));
    }).then(status => res.status(status.state === 'aborting' ? CONST.HTTP_STATUS_CODE.ACCEPTED : CONST.HTTP_STATUS_CODE.OK).send(status.response));
  }

  startRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    const backupGuid = req.body.backup_guid;
    const timeStamp = req.body.time_stamp;
    const tenantId = req.entity.tenant_id;
    const instanceId = req.params.instance_id;
    const serviceId = req.manager.service.id;
    const bearer = _
      .chain(req.headers)
      .get('authorization')
      .split(' ')
      .nth(1)
      .value();
    return Promise
      .try(() => {
        if (!backupGuid && !timeStamp) {
          throw new BadRequest('Invalid input as backupGuid or timeStamp not present');
        } else if (backupGuid) {
          return this.validateUuid(backupGuid, 'Backup GUID');
        } else if (timeStamp) {
          return this.validateDateString(timeStamp);
        }
      })
      .then(() => this.backupStore
        .getBackupFile(timeStamp ? {
          time_stamp: timeStamp,
          tenant_id: tenantId,
          instance_id: instanceId,
          service_id: serviceId
        } : {
            backup_guid: backupGuid,
            tenant_id: tenantId
          })
      )
      .catchThrow(NotFound, new UnprocessableEntity(`No backup with guid '${backupGuid}' found in this space`))
      .tap(metadata => {
        if (metadata.state !== 'succeeded') {
          throw new UnprocessableEntity(`Can not restore backup '${backupGuid}' due to state '${metadata.state}'`);
        }
        if (!req.manager.isRestorePossible(metadata.plan_id)) {
          throw new UnprocessableEntity(`Cannot restore backup: '${backupGuid}' to plan:'${metadata.plan_id}'`);
        }
      })
      .then(metadata => this.fabrik
        .createOperation('restore', {
          instance_id: req.params.instance_id,
          bearer: bearer,
          arguments: _.assign({
            backup: _.pick(metadata, 'type', 'secret')
          }, req.body, {
              backup_guid: backupGuid || metadata.backup_guid
            })
        })
        .handle(req, res)
      );
  }

  getLastRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    const instanceId = req.params.instance_id;
    const tenantId = req.entity.tenant_id;
    return req.manager
      .getLastRestore(tenantId, instanceId)
      .then(result => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(result)
      )
      .catchThrow(NotFound, new NotFound(`No restore found for service instance '${instanceId}'`));
  }

  abortLastRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    const instanceId = req.params.instance_id;
    const tenantId = req.entity.tenant_id;
    return req.manager
      .abortLastRestore(tenantId, instanceId)
      .then(result => res
        .status(result.state === 'aborting' ? CONST.HTTP_STATUS_CODE.ACCEPTED : CONST.HTTP_STATUS_CODE.OK)
        .send({})
      );
  }

  listBackups(req, res) {
    const options = _.pick(req.query, 'service_id', 'plan_id', 'instance_id', 'before', 'after');
    options.tenant_id = req.entity.tenant_id;
    return this.listBackupFiles(options)
      .then(body => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(body)
      );
  }

  listBackupFiles(options) {
    function getPredicate(before, after, instanceId) {
      return function predicate(filenameobject) {
        if (before && !_.lt(filenameobject.started_at, before)) {
          return false;
        }
        if (after && !_.gt(filenameobject.started_at, after)) {
          return false;
        }
        if (instanceId && filenameobject.instance_guid !== instanceId) {
          return false;
        }
        return filenameobject.operation === 'backup';
      };
    }

    return Promise
      .try(() => {
        if (options.instance_id && !options.plan_id) {
          return this.cloudController
            .findServicePlanByInstanceId(options.instance_id)
            .then(resource => {
              options.plan_id = resource.entity.unique_id;
            })
            .catch(ServiceInstanceNotFound, () =>
              logger.info(`+-> Instance ${options.instance_id} not found, continue listing backups for the deleted instance`));
        }
      })
      .then(() => {
        if (options.plan_id && !options.service_id) {
          options.service_id = this.getPlan(options.plan_id).service.id;
        }
        const before = options.before ? filename.isoDate(options.before) : undefined;
        const after = options.after ? filename.isoDate(options.after) : undefined;
        const predicate = getPredicate(before, after, options.instance_id);
        return this.backupStore.listBackupFiles(options, predicate);
      })
      .map(data => _.omit(data, 'secret', 'agent_ip', 'logs'));
  }

  listLastOperationOfAllInstances(req, res) {
    return Promise
      .try(() => {
        const options = _.pick(req.query, 'service_id', 'plan_id');
        options.tenant_id = req.entity.tenant_id;
        switch (req.params.operation) {
          case 'backup':
            return this.backupStore.listLastBackupFiles(options);
          case 'restore':
            return this.backupStore.listLastRestoreFiles(options);
        }
        assert.ok(false, 'List result of last operation is only possible for \'backup\' or \'restore\'');
      })
      .map(data => _.omit(data, 'secret', 'agent_ip', 'logs'))
      .then(body => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(body)
      );
  }

  getBackup(req, res) {
    const options = _
      .chain(req.params)
      .pick('backup_guid')
      .assign(_.omit(req.query, 'space_guid'))
      .value();
    options.tenant_id = req.entity.tenant_id;
    return this.backupStore
      .getBackupFile(options)
      .then(data => _.omit(data, 'secret', 'agent_ip'))
      .then(body => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(body)
      );
  }

  deleteBackup(req, res) {
    const options = {
      tenant_id: req.entity.tenant_id,
      backup_guid: req.params.backup_guid,
      user: req.user
    };
    return this.backupStore
      .deleteBackupFile(options)
      .then(() => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send({})
      );
  }

  scheduleBackup(req, res) {
    req.manager.verifyFeatureSupport('backup');
    if (_.isEmpty(req.body.repeatInterval) || _.isEmpty(req.body.type)) {
      throw new BadRequest('repeatInterval | type are mandatory');
    }
    const data = _
      .chain(req.body)
      .omit('repeatInterval')
      .set('instance_id', req.params.instance_id)
      .set('trigger', CONST.BACKUP.TRIGGER.SCHEDULED)
      .set('tenant_id', req.entity.tenant_id)
      .set('plan_id', req.manager.plan.id)
      .set('service_id', req.manager.service.id)
      .value();
    return this.cloudController.getOrgAndSpaceDetails(data.instance_id, data.tenant_id)
      .then(space => {
        const serviceDetails = catalog.getService(data.service_id);
        const planDetails = catalog.getPlan(req.manager.plan.id);
        _.chain(data)
          .set('service_name', serviceDetails.name)
          .set('service_plan_name', planDetails.name)
          .set('space_name', space.space_name)
          .set('organization_name', space.organization_name)
          .set('organization_guid', space.organization_guid)
          .value();
        return ScheduleManager
          .schedule(
          req.params.instance_id,
          CONST.JOB.SCHEDULED_BACKUP,
          req.body.repeatInterval,
          data,
          req.user)
          .then(body => res
            .status(CONST.HTTP_STATUS_CODE.CREATED)
            .send(body));
      });
  }

  getBackupSchedule(req, res) {
    req.manager.verifyFeatureSupport('backup');
    return ScheduleManager
      .getSchedule(req.params.instance_id, CONST.JOB.SCHEDULED_BACKUP)
      .then(body => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(body));
  }

  cancelScheduledBackup(req, res) {
    req.manager.verifyFeatureSupport('backup');
    if (!_.get(req, 'cloudControllerScopes').includes('cloud_controller.admin')) {
      throw new Forbidden(`Permission denined. Cancelling of backups can only be done by user with cloud_controller.admin scope.`);
    }
    return ScheduleManager
      .cancelSchedule(req.params.instance_id, CONST.JOB.SCHEDULED_BACKUP)
      .then(() => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send({}));
  }

  scheduleUpdate(req, res) {
    req.manager.isAutoUpdatePossible();
    if (_.isEmpty(req.body.repeatInterval)) {
      throw new BadRequest('repeatInterval is mandatory');
    }
    return req.manager.findDeploymentNameByInstanceId(req.params.instance_id)
      .then(deploymentName => _
        .chain({
          instance_id: req.params.instance_id,
          instance_name: req.entity.name,
          deployment_name: deploymentName
        })
        .assign(_.omit(req.body, 'repeatInterval'))
        .value()
      )
      .then((jobData) => ScheduleManager
        .schedule(req.params.instance_id,
        CONST.JOB.SERVICE_INSTANCE_UPDATE,
        req.body.repeatInterval,
        jobData,
        req.user))
      .then(body => res
        .status(CONST.HTTP_STATUS_CODE.CREATED)
        .send(body));
  }

  getUpdateSchedule(req, res) {
    req.manager.isAutoUpdatePossible();
    return ScheduleManager
      .getSchedule(req.params.instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE)
      .then(scheduleInfo => {
        const checkUpdateRequired = _.get(req.query, 'check_update_required');
        logger.info(`Instance Id: ${req.params.instance_id} - check outdated status - ${checkUpdateRequired}`);
        if (checkUpdateRequired) {
          return req.manager
            .findDeploymentNameByInstanceId(req.params.instance_id)
            .then(deploymentName => this.cloudController.getOrgAndSpaceGuid(req.params.instance_id)
              .then(opts => {
                const context = {
                  platform: CONST.PLATFORM.CF,
                  organization_guid: opts.organization_guid,
                  space_guid: opts.space_guid
                };
                opts.context = context;
                return req.manager.diffManifest(deploymentName, opts);
              })
              .then(result => utils.unifyDiffResult(result))
            )
            .then(result => {
              scheduleInfo.update_required = result && result.length > 0;
              scheduleInfo.update_details = result;
              return scheduleInfo;
            });
        } else {
          return scheduleInfo;
        }
      })
      .then(body => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(body));
  }

  static get version() {
    return '1.0';
  }

}

module.exports = ServiceFabrikApiController;
