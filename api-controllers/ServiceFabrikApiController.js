'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const jwt = require('../broker/lib/jwt');
const logger = require('../common/logger');
const backupStore = require('../data-access-layer/iaas').backupStore;
const filename = backupStore.filename;
const eventmesh = require('../data-access-layer/eventmesh');
const lockManager = eventmesh.lockManager;
const errors = require('../common/errors');
const BackupService = require('../managers/backup-manager');
const RestoreService = require('../managers/restore-manager');
const FabrikBaseController = require('./FabrikBaseController');
const Unauthorized = errors.Unauthorized;
const NotFound = errors.NotFound;
const Gone = errors.Gone;
const cf = require('../data-access-layer/cf');
const Forbidden = errors.Forbidden;
const BadRequest = errors.BadRequest;
const UnprocessableEntity = errors.UnprocessableEntity;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const JsonWebTokenError = jwt.JsonWebTokenError;
const ContinueWithNext = errors.ContinueWithNext;
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
const AssertionError = assert.AssertionError;
const ScheduleManager = require('../jobs');
const config = require('../common/config');
const CONST = require('../common/constants');
const catalog = require('../common/models').catalog;
const utils = require('../common/utils');
const docker = config.enable_swarm_manager ? require('../data-access-layer/docker') : undefined;

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

  getBackupOptions(backupGuid, req) {
    return Promise
      .all([
        cf.cloudController.findServicePlanByInstanceId(req.params.instance_id),
        cf.cloudController.getOrgAndSpaceGuid(req.params.instance_id)
      ])
      .spread((planDetails, orgAndSpaceDetails) => {
        const context = req.body.context || {
          space_guid: orgAndSpaceDetails.space_guid,
          platform: CONST.PLATFORM.CF
        };
        const backupOptions = {
          guid: backupGuid,
          instance_guid: req.params.instance_id,
          plan_id: req.body.plan_id || planDetails.entity.unique_id,
          service_id: req.body.service_id || this.getPlan(planDetails.entity.unique_id).service.id,
          arguments: req.body,
          username: req.user.name,
          useremail: req.user.email || '',
          context: context
        };
        return backupOptions;
      });
  }

  getRestoreOptions(req, metadata) {
    return Promise
      .try(() => {
        const restoreOptions = {
          plan_id: metadata.plan_id,
          service_id: metadata.service_id,
          context: req.body.context || {
            space_guid: req.entity.tenant_id,
            platform: CONST.PLATFORM.CF
          },
          restore_guid: metadata.restore_guid,
          instance_guid: req.params.instance_id,
          arguments: _.assign({
              backup: _.pick(metadata, 'type', 'secret')
            },
            req.body, {
              backup_guid: _.get(metadata, 'backup_guid')
            }),
          username: req.user.name
        };
        logger.debug('Restore options:', restoreOptions);
        return restoreOptions;
      });
  }

  startBackup(req, res) {
    let lockedDeployment = false; // Need not unlock if checkQuota fails for parallelly triggered on-demand backup
    let lockId;
    req.manager.verifyFeatureSupport(CONST.OPERATION_TYPE.BACKUP);
    const trigger = _.get(req.body, 'trigger', CONST.BACKUP.TRIGGER.ON_DEMAND);
    let backupGuid;
    return Promise
      .try(() => this.checkQuota(req, trigger))
      .then(() => utils.uuidV4())
      .then(guid => {
        _.set(req.body, 'trigger', trigger);
        backupGuid = guid;
        return this.getBackupOptions(backupGuid, req)
          .then(backupOptions => {
            logger.info(`Triggering backup with options: ${JSON.stringify(backupOptions)}`);
            // Acquire read lock
            return lockManager.lock(req.params.instance_id, {
                lockedResourceDetails: {
                  resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                  resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                  resourceId: backupGuid,
                  operation: CONST.OPERATION_TYPE.BACKUP
                }
              })
              .then(lockResourceId => {
                lockedDeployment = true;
                lockId = lockResourceId;
                return eventmesh.apiServerClient.createResource({
                  resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                  resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                  resourceId: backupGuid,
                  labels: {
                    instance_guid: req.params.instance_id
                  },
                  options: backupOptions,
                  status: {
                    state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
                    lastOperation: {},
                    response: {}
                  }
                });
              });
          });
      })
      .then(() => eventmesh.apiServerClient.updateLastOperationValue({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        operationName: CONST.OPERATION_TYPE.BACKUP,
        operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: req.params.instance_id,
        value: backupGuid
      }))
      .then(() => {
        res.status(CONST.HTTP_STATUS_CODE.ACCEPTED).send({
          name: CONST.OPERATION_TYPE.BACKUP,
          guid: backupGuid
        });
      })
      .catch(err => {
        logger.info('Handling error :', err);
        if (err instanceof DeploymentAlreadyLocked) {
          throw err;
        }
        if (lockedDeployment) {
          return lockManager.unlock(req.params.instance_id, lockId)
            .throw(err);
        }
        throw err;
      });
  }

  getLastBackup(req, res) {
    req.manager.verifyFeatureSupport('backup');
    // TODO-PR: We should get lastOperation response from querying backup resource with instance_guid
    return eventmesh.apiServerClient.getLastOperationValue({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        operationName: CONST.OPERATION_TYPE.BACKUP,
        operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: req.params.instance_id
      })
      .then(backupGuid =>
        eventmesh.apiServerClient.getResponse({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: backupGuid
        })
      )
      .catch(NotFound, AssertionError, err => {
        // This code block is specifically for the transition of Service Fabrik to v2
        // Here we reffer to BackupService to get the lastBackup status
        logger.info('Backup metadata not found in apiserver, checking blobstore. Error message:', err.message);
        const tenantId = req.entity.tenant_id;
        return cf.cloudController.getPlanIdFromInstanceId(req.params.instance_id)
          .then(plan_id => BackupService.createService(catalog.getPlan(plan_id)))
          .then(backupService => backupService.getLastBackup(tenantId, req.params.instance_id));
      })
      .then(result => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(_.omit(result, 'secret', 'agent_ip', 'description'))
      )
      .catch(NotFound, (err) => {
        logger.error('Error occured during getLastBackup ', err);
        throw new NotFound(`No backup found for service instance '${req.params.instance_id}'`);
      });
  }

  abortLastBackup(req, res) {
    req.manager.verifyFeatureSupport('backup');
    return eventmesh
      .apiServerClient.getLastOperationValue({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        operationName: CONST.OPERATION_TYPE.BACKUP,
        operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: req.params.instance_id
      })
      .then(backupGuid => {
        return eventmesh
          .apiServerClient.getResourceState({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            resourceId: backupGuid
          })
          .then(state => {
            // abort only if the state is in progress
            if (state === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS) {
              return eventmesh.apiServerClient.updateResource({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                resourceId: backupGuid,
                status: {
                  'state': CONST.OPERATION.ABORT
                }
              });
            } else {
              logger.info(`Skipping abort for ${backupGuid} as state is : ${state}`);
            }
          })
          .then(() => eventmesh.apiServerClient.getResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            resourceId: backupGuid,
            start_state: CONST.OPERATION.ABORT,
            started_at: new Date()
          }));
      })
      .then(status => res.status(status.state === 'aborting' ? CONST.HTTP_STATUS_CODE.ACCEPTED : CONST.HTTP_STATUS_CODE.OK).send({}));
  }

  startRestore(req, res) {
    let lockedDeployment = false; // Need not unlock if checkQuota fails for parallelly triggered on-demand backup
    // TODO move verifyFeatureSupport out of manager
    req.manager.verifyFeatureSupport('restore');
    let restoreGuid, serviceId, planId;
    const backupGuid = req.body.backup_guid;
    const timeStamp = req.body.time_stamp;
    const tenantId = req.entity.tenant_id;
    const sourceInstanceId = req.body.source_instance_id || req.params.instance_id;
    return Promise
      .all([
        utils.uuidV4(),
        cf.cloudController.findServicePlanByInstanceId(req.params.instance_id)
      ])
      .spread((guid, planDetails) => {
        serviceId = this.getPlan(planDetails.entity.unique_id).service.id;
        planId = planDetails.entity.unique_id;
        restoreGuid = guid;
        logger.debug(`Restore options: backupGuid ${backupGuid} at ${timeStamp}`);
        if (!backupGuid && !timeStamp) {
          throw new BadRequest('Invalid input as backupGuid or timeStamp not present');
        } else if (timeStamp) {
          const service = this.getService(serviceId);
          const isPitrEnabled = _.get(service, 'pitr');
          if (!isPitrEnabled) {
            logger.debug(`Non pitr service : ${serviceId}`);
            throw new BadRequest(`Time based recovery not supported for service ${_.get(service, 'name')}`);
          }
          return this.validateRestoreTimeStamp(timeStamp);
        } else if (backupGuid) {
          return this.validateUuid(backupGuid, 'Backup GUID');
        }
      })
      .then(() => this.validateRestoreQuota({
        instance_guid: req.params.instance_id,
        service_id: serviceId,
        plan_id: planId,
        tenant_id: tenantId
      }))
      .then(() => {
        const backupFileOptions = timeStamp ? {
          time_stamp: timeStamp,
          tenant_id: tenantId,
          instance_id: sourceInstanceId,
          service_id: serviceId
        } : {
          backup_guid: backupGuid,
          tenant_id: tenantId
        };
        if (timeStamp) {
          return this.backupStore
            .listBackupsOlderThan(backupFileOptions, new Date(Number(timeStamp)))
            .then(sortedOldBackups =>
              _.findLast(sortedOldBackups, backup => backup.state === CONST.OPERATION.SUCCEEDED))
            .then(successfulBackup => {
              if (_.isEmpty(successfulBackup)) {
                logger.error(`No successful backup found for service instance '${sourceInstanceId}' before time_stamp ${new Date(timeStamp)}`);
                throw new NotFound(`Cannot restore service instance '${sourceInstanceId}' as no successful backup found before time_stamp ${timeStamp}`);
              } else {
                return successfulBackup;
              }
            });
        } else {
          return this.backupStore.getBackupFile(backupFileOptions);
        }
      })
      .catchThrow(NotFound, new UnprocessableEntity(`Cannot restore for guid/timeStamp '${timeStamp || backupGuid}' as no successful backup found in this space.`))
      .then(metadata => {
        metadata.restore_guid = restoreGuid;
        if (metadata.state !== 'succeeded') {
          throw new UnprocessableEntity(`Can not restore for guid/timeStamp '${timeStamp || backupGuid}' due to state '${metadata.state}'`);
        }
        if (!req.manager.isRestorePossible(metadata.plan_id)) {
          throw new UnprocessableEntity(`Cannot restore for guid/timeStamp: '${timeStamp || backupGuid}' to plan:'${metadata.plan_id}'`);
        }
        return metadata;
      })
      .then(metadata => this
        .getRestoreOptions(req, metadata)
        .then(restoreOptions => {
          logger.info(`Triggering restore with options: ${JSON.stringify(restoreOptions)}`);
          return lockManager.lock(req.params.instance_id, {
              lockedResourceDetails: {
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
                resourceId: restoreGuid,
                operation: CONST.OPERATION_TYPE.RESTORE
              }
            })
            .then(() => {
              lockedDeployment = true;
              return eventmesh.apiServerClient.createResource({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
                //TODO read from plan details
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
                resourceId: restoreGuid,
                options: restoreOptions,
                status: {
                  state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
                  lastOperation: {},
                  response: {}
                }
              });
            });
        })
      )
      .then(() => {
        //check if resource exist, else create and then update
        return eventmesh.apiServerClient.updateLastOperationValue({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          operationName: CONST.OPERATION_TYPE.RESTORE,
          operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
          resourceId: req.params.instance_id,
          value: restoreGuid
        });
      })
      .then(() => {
        return res.status(CONST.HTTP_STATUS_CODE.ACCEPTED).send({
          name: CONST.OPERATION_TYPE.RESTORE,
          guid: restoreGuid
        });
      })
      .catch(err => {
        logger.error('Handling error while starting restore:', err);
        if (err instanceof DeploymentAlreadyLocked) {
          throw err;
        }
        if (lockedDeployment) {
          return lockManager.unlock(req.params.instance_id)
            .throw(err);
        }
        throw err;
      });
  }

  getLastRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    const instanceId = req.params.instance_id;
    const tenantId = req.entity.tenant_id;

    return eventmesh.apiServerClient.getLastOperationValue({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        operationName: CONST.OPERATION_TYPE.RESTORE,
        operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
        resourceId: req.params.instance_id
      })
      .then(restoreGuid =>
        eventmesh.apiServerClient.getResponse({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
          resourceId: restoreGuid
        })
      )
      .catch(NotFound, AssertionError, (err) => {
        // This code block is specifically for the transition of Service Fabrik to v2
        // Here we reffer to RestoreService to get the lastRestore status
        logger.info('Restore metadata not found in apiserver, checking blobstore. Error message:', err.message);
        return cf.cloudController.getPlanIdFromInstanceId(req.params.instance_id)
          .then(plan_id => RestoreService.createService(catalog.getPlan(plan_id)))
          .then(restoreService => restoreService.getLastRestore(tenantId, req.params.instance_id));
      })
      .then(result => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send(result)
      )
      // .catchThrow(NotFound, new NotFound(`No restore found for service instance '${instanceId}'`));
      .catch(e => {
        logger.error('Caught error while getting last restore', e); // TODO fix this
        throw new NotFound(`No restore found for service instance '${instanceId}'`);
      });
  }

  abortLastRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    return eventmesh
      .apiServerClient.getLastOperationValue({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        operationName: CONST.OPERATION_TYPE.RESTORE,
        operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
        resourceId: req.params.instance_id
      })
      .then(restoreGuid => {
        return eventmesh
          .apiServerClient.getResourceState({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
            resourceId: restoreGuid
          })
          .then(state => {
            // abort only if the state is in progress
            if (_.includes([CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS, CONST.RESTORE_OPERATION.PROCESSING], state)) {
              return eventmesh.apiServerClient.updateResource({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
                resourceId: restoreGuid,
                status: {
                  'state': CONST.OPERATION.ABORT
                }
              });
            } else {
              logger.info(`Skipping abort for ${restoreGuid} as state is : ${state}`);
            }
          })
          .then(() => eventmesh.apiServerClient.getResourceOperationStatus({
            resourceId: restoreGuid,
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
            start_state: CONST.OPERATION.ABORT,
            started_at: new Date()
          }));
      })
      .then(result => res
        .status(result.state === CONST.OPERATION.ABORTING ? CONST.HTTP_STATUS_CODE.ACCEPTED : CONST.HTTP_STATUS_CODE.OK)
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
    logger.info('Attempting delete with:', options);
    return eventmesh
      .apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: req.params.backup_guid,
        options: options,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.DELETE
        }
      })
      // Migration Code: to be removed 
      .catch(NotFound, (err) => {
        // if not found in apiserver delete from blobstore
        logger.info('Backup metadata not found in apiserver, checking blobstore. Error message:', err.message);
        return this.backupStore.deleteBackupFile(options);
      })
      .then(() => eventmesh.apiServerClient.getResourceOperationStatus({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: req.params.backup_guid,
        start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
        started_at: new Date()
      }))
      //delete resource from apiserver here if state is deleted 
      .then(() => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: req.params.backup_guid
      }))
      .then(() => res
        .status(CONST.HTTP_STATUS_CODE.OK)
        .send({})
      )
      .catchThrow(NotFound, new Gone('Backup does not exist or has already been deleted'));
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
          deployment_name: deploymentName,
          run_immediately: (req.body.runImmediately === 'true' ? true : false)
        })
        .assign(_.omit(req.body, ['repeatInterval', 'runImmediately']))
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