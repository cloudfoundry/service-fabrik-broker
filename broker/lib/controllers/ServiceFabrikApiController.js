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
const Forbidden = errors.Forbidden;
const BadRequest = errors.BadRequest;
const Conflict = errors.Conflict;
const UnprocessableEntity = errors.UnprocessableEntity;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const JsonWebTokenError = jwt.JsonWebTokenError;
const ContinueWithNext = errors.ContinueWithNext;
const InternalServerError = errors.InternalServerError;
const ETCDLockError = errors.ETCDLockError;
const ScheduleManager = require('../jobs');
const config = require('../config');
const CONST = require('../constants');
const catalog = require('../models').catalog;
const utils = require('../utils');
const docker = config.enable_swarm_manager ? require('../docker') : undefined;
const unlockEtcdResource = require('../utils/EtcdLockHelper').unlockEtcdResource;

const CloudControllerError = {
  NotAuthorized: err => {
    const body = err.error;
    return err.statusCode === 403 && (
      body.code === 10003 || body.error_code === 'CF-NotAuthorized'
    );
  }
};


class ServiceFabrikApiController extends FabrikBaseController {
  constructor() {
    super();
  }

  /**
   * @param opts
   * @param opts.resourceId
   * @param opts.annotationId
   * @param opts.start_state
   * @param opts.started_at
   */
  static getResourceAnnotationStatus(opts) {
    logger.info(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the annotation state`);
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => eventmesh.server.getAnnotationState({
        resourceId: opts.resourceId,
        annotationName: CONST.OPERATION_TYPE.BACKUP,
        annotationType: 'defaultbackups',
        annotationId: opts.annotationId
      })).then(state => {
        const duration = (new Date() - opts.started_at) / 1000;
        const backup_start_timeout = CONST.BACKUP.BACKUP_START_TIMEOUT; //sec
        logger.info(`Polling for ${opts.start_state} duration: ${duration} `);
        if (duration > backup_start_timeout) {
          throw new Timeout(`Backup not picked up from queue`);
        }
        if (state === opts.start_state) {
          return ServiceFabrikApiController.getResourceAnnotationStatus(opts);
        } else if (state === CONST.RESOURCE_STATE.ERROR) {
          return eventmesh.server.getAnnotationKeyValue({
            resourceId: opts.resourceId,
            annotationName: CONST.OPERATION_TYPE.BACKUP,
            annotationType: 'defaultbackups',
            annotationId: opts.annotationId,
            key: CONST.ANNOTATION_KEYS.RESULT
          })
            .then(error => {
              let json = JSON.parse(error)
              logger.info('Operation manager reported error', json);
              let message = json.message;
              if (json.error && json.error.description) {
                message = `${message}. ${json.error.description}`
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
            })
        } else {
          return eventmesh.server.getAnnotationResult({
            resourceId: opts.resourceId,
            annotationName: CONST.OPERATION_TYPE.BACKUP,
            annotationType: 'defaultbackups',
            annotationId: opts.annotationId,
          });
        }
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
        const tenant_id = _.get(req, 'body.space_guid') || _.get(req, 'query.space_guid') ||
          _.get(req, 'query.tenant_id') || _.get(req, 'body.context.space_guid') || _.get(req, 'body.context.namespace');

        if (tenant_id) {
          if ((platform === CONST.PLATFORM.CF && !FabrikBaseController.uuidPattern.test(tenant_id)) ||
            (platform === CONST.PLATFORM.K8S && !FabrikBaseController.k8sNamespacePattern.test(tenant_id))) {
            throw new BadRequest(`Invalid 'uuid' or 'name' '${tenant_id}'`);
          }
          return tenant_id;
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
        .status(200)
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
    logger.info(`Service fabrik enabled: ${config.enableServiceFabrikV2}`)
    if (config.enableServiceFabrikV2) {
      return this.startBackup_sf20(req, res);
    }
    logger.info(`Calling service fabrik v1`)
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
            .status(202)
            .send(body)
          );
      });
  }

  startBackup_sf20(req, res) {
    let backup_started_at;
    req.manager.verifyFeatureSupport(CONST.OPERATION_TYPE.BACKUP);
    const trigger = _.get(req.body, 'trigger', CONST.BACKUP.TRIGGER.ON_DEMAND);
    let backup_guid, deploymentName;
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
        backup_guid = guid;
        const backup_options = {
          guid: backup_guid,
          deployment: deployment,
          instance_guid: req.params.instance_id,
          plan_id: req.body.plan_id,
          service_id: req.body.service_id,
          context: req.body.context
        };
        // Acquire read lock for resource resourceId
        logger.info(`Attempting to acquire lock on deployment with instanceid: ${req.params.instance_id} `);
        return lockManager.lock(req.params.instance_id, {
          lockType: CONST.ETCD.LOCK_TYPE.READ,
          lockedResourceDetails: {
            resourceType: CONST.RESOURCE_TYPES.BACKUP,
            resourceName: CONST.RESOURCE_NAMES.DEFAULT_BACKUP,
            resourceId: backup_guid
          }
        })
          .then(() => {
            return eventmesh.server.annotateResource({
              resourceId: req.params.instance_id,
              annotationName: CONST.OPERATION_TYPE.BACKUP,
              annotationType: 'defaultbackups',
              annotationId: backup_guid,
              val: JSON.stringify(backup_options)
            });
          });
      })
      .then(() => {
        backup_started_at = new Date()
	//check if resource exist, else create and then update
        return Promise.try( () => eventmesh.server.getResource('deployment','directors', req.params.instance_id))
        .catch( () => eventmesh.server.createResource( null, req.params.instance_id, {}))
        .then( () => eventmesh.server.updateLastAnnotation({
          resourceId: req.params.instance_id,
          annotationName: CONST.OPERATION_TYPE.BACKUP,
          annotationType: 'defaultbackups',
          value: backup_guid
        }))
	.then(() => ServiceFabrikApiController.getResourceAnnotationStatus({
          resourceId: req.params.instance_id,
          annotationId: backup_guid,
          start_state: CONST.RESOURCE_STATE.IN_QUEUE,
          started_at: backup_started_at
        }));
      })
      .tap(response => {
        logger.info(`Backup Response `, response);
        const directorManager = req.manager;
        return directorManager
          .findNetworkSegmentIndex(req.params.instance_id)
          .then(networkIndex => {
            logger.error('NetworkIndex is ', req.params, networkIndex);
            return directorManager.getDeploymentName(req.params.instance_id, networkIndex);
          })
      })
      .then(bodyStr => {
        logger.info('Annotation response:', bodyStr );
        const body = JSON.parse(bodyStr);
        res.status(202).send(body);
      })
      .catch(err => {
        logger.info( 'Handling error :', err);
        if (err instanceof ETCDLockError) {
          throw err;
        }
        logger.info(`Attempting to release lock on deployment with instanceid: ${req.params.instance_id} `);
        return unlockEtcdResource(req.params.instance_id)
          .throw(err);
      })
      .catch(Timeout, (err) => {
        return this.abortLastBackup(req, res);
      });
  }

  getLastBackup(req, res) {
    req.manager.verifyFeatureSupport('backup');
    const instance_id = req.params.instance_id;
    const noCache = req.query.no_cache === 'true' ? true : false;
    const tenant_id = req.entity.tenant_id;
    return req.manager
      .getLastBackup(tenant_id, instance_id, noCache)
      .then(result => res
        .status(200)
        .send(_.omit(result, 'secret', 'agent_ip'))
      )
      .catchThrow(NotFound, new NotFound(`No backup found for service instance '${instance_id}'`));
  }

  abortLastBackup(req, res) {
    if (config.enableServiceFabrikV2) {
      return this.abortLastBackup20(req, res)
    }
    return this.abortLastBackup10(req, res)
  }

  abortLastBackup10(req, res) {
    req.manager.verifyFeatureSupport('backup');
    const instance_id = req.params.instance_id;
    const tenant_id = req.entity.tenant_id;
    return req.manager
      .abortLastBackup(tenant_id, instance_id)
      .then(result => res
        .status(result.state === 'aborting' ? 202 : 200)
        .send({})
      );
  }


  abortLastBackup20(req, res) {
    req.manager.verifyFeatureSupport('backup');
    const instance_id = req.params.instance_id;
    const tenant_id = req.entity.tenant_id;
    const backup_started_at = new Date();
    return eventmesh.server.getLastAnnotation({
      resourceId: req.params.instance_id,
      annotationName: CONST.OPERATION_TYPE.BACKUP,
      annotationType: 'defaultbackups',
    }).then(backup_guid => {
      return eventmesh.server.getAnnotationState({
        resourceId: req.params.instance_id,
        annotationName: CONST.OPERATION_TYPE.BACKUP,
        annotationType: 'defaultbackups',
        annotationId: backup_guid,
      }).then(state => {
        // abort only if the state is in progress
        if (state === CONST.RESOURCE_STATE.IN_PROGRESS) {
          return eventmesh.server.updateAnnotationState({
            resourceId: req.params.instance_id,
            annotationName: CONST.OPERATION_TYPE.BACKUP,
            annotationType: 'defaultbackups',
            annotationId: backup_guid,
            stateValue: 'abort'
          })
        } else {
          logger.info(`Skipping abort as state is : ${state}`)
        }
      }).then(() => ServiceFabrikApiController.getResourceAnnotationStatus({
        resourceId: req.params.instance_id,
        annotationId: backup_guid,
        start_state: 'abort',
        started_at: backup_started_at
      }))
    }).then(result => res.status(result.state === 'aborting' ? 202 : 200).send(result));
  }

  startRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    const backup_guid = req.body.backup_guid;
    const time_stamp = req.body.time_stamp;
    const tenant_id = req.entity.tenant_id;
    const instance_id = req.params.instance_id;
    const service_id = req.manager.service.id;
    const bearer = _
      .chain(req.headers)
      .get('authorization')
      .split(' ')
      .nth(1)
      .value();
    return Promise
      .try(() => {
        if (!backup_guid && !time_stamp) {
          throw new BadRequest('Invalid input as backup_guid or time_stamp not present');
        } else if (backup_guid) {
          return this.validateUuid(backup_guid, 'Backup GUID');
        } else if (time_stamp) {
          return this.validateDateString(time_stamp);
        }
      })
      .then(() => this.backupStore
        .getBackupFile(time_stamp ? {
          time_stamp: time_stamp,
          tenant_id: tenant_id,
          instance_id: instance_id,
          service_id: service_id
        } : {
            backup_guid: backup_guid,
            tenant_id: tenant_id
          })
      )
      .catchThrow(NotFound, new UnprocessableEntity(`No backup with guid '${backup_guid}' found in this space`))
      .tap(metadata => {
        if (metadata.state !== 'succeeded') {
          throw new UnprocessableEntity(`Can not restore backup '${backup_guid}' due to state '${metadata.state}'`);
        }
        if (!req.manager.isRestorePossible(metadata.plan_id)) {
          throw new UnprocessableEntity(`Cannot restore backup: '${backup_guid}' to plan:'${metadata.plan_id}'`);
        }
      })
      .then(metadata => this.fabrik
        .createOperation('restore', {
          instance_id: req.params.instance_id,
          bearer: bearer,
          arguments: _.assign({
            backup: _.pick(metadata, 'type', 'secret')
          }, req.body, {
              backup_guid: backup_guid || metadata.backup_guid
            })
        })
        .handle(req, res)
      );
  }

  getLastRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    const instance_id = req.params.instance_id;
    const tenant_id = req.entity.tenant_id;
    return req.manager
      .getLastRestore(tenant_id, instance_id)
      .then(result => res
        .status(200)
        .send(result)
      )
      .catchThrow(NotFound, new NotFound(`No restore found for service instance '${instance_id}'`));
  }

  abortLastRestore(req, res) {
    req.manager.verifyFeatureSupport('restore');
    const instance_id = req.params.instance_id;
    const tenant_id = req.entity.tenant_id;
    return req.manager
      .abortLastRestore(tenant_id, instance_id)
      .then(result => res
        .status(result.state === 'aborting' ? 202 : 200)
        .send({})
      );
  }

  listBackups(req, res) {
    const options = _.pick(req.query, 'service_id', 'plan_id', 'instance_id', 'before', 'after');
    options.tenant_id = req.entity.tenant_id;
    return this.listBackupFiles(options)
      .then(body => res
        .status(200)
        .send(body)
      );
  }

  listBackupFiles(options) {
    function getPredicate(before, after, instance_id) {
      return function predicate(filenameobject) {
        if (before && !_.lt(filenameobject.started_at, before)) {
          return false;
        }
        if (after && !_.gt(filenameobject.started_at, after)) {
          return false;
        }
        if (instance_id && filenameobject.instance_guid !== instance_id) {
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
        .status(200)
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
        .status(200)
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
        .status(200)
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
            .status(201)
            .send(body));
      });
  }

  getBackupSchedule(req, res) {
    req.manager.verifyFeatureSupport('backup');
    return ScheduleManager
      .getSchedule(req.params.instance_id, CONST.JOB.SCHEDULED_BACKUP)
      .then(body => res
        .status(200)
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
        .status(200)
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
        .status(201)
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
        .status(200)
        .send(body));
  }

  static get version() {
    return '1.0';
  }

}

module.exports = ServiceFabrikApiController;
