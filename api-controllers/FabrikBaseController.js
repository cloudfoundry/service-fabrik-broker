'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const BaseController = require('../common/controllers/BaseController');
const config = require('../common/config');
const logger = require('../common/logger');
const errors = require('../common/errors');
const cf = require('../data-access-layer/cf');
const bosh = require('../data-access-layer/bosh');
const fabrik = require('../broker/lib/fabrik');
const backupStore = require('../data-access-layer/iaas').backupStore;
const catalog = require('../common/models/catalog');
const ContinueWithNext = errors.ContinueWithNext;
const BadRequest = errors.BadRequest;
const NotFound = errors.NotFound;
const CONST = require('../common/constants');
const lockManager = require('../data-access-layer/eventmesh').lockManager;

class FabrikBaseController extends BaseController {
  constructor() {
    super();
    this.fabrik = fabrik;
    this.cloudController = cf.cloudController;
    this.uaa = cf.uaa;
    this.director = bosh.director;
    this.backupStore = backupStore;
  }

  get serviceBrokerName() {
    return _.get(config, 'broker_name', 'service-fabrik-broker');
  }

  handleWithResourceLocking(func, operationType) {
    return (req, res, next) => {
      let resourceLocked = false;
      let processedRequest = false;
      let lockId;
      return this._lockResource(req, operationType)
        .tap(() => resourceLocked = true)
        .then(lockResourceId => {
          lockId = lockResourceId;
          const fn = _.isString(func) ? this[func] : func;
          return fn.call(this, req, res);
        })
        .tap(() => processedRequest = true)
        .then(() => this._unlockIfReqfailed(operationType, processedRequest, lockId, req, res, next))
        .catch(err => resourceLocked ? this._unlockIfReqfailed(operationType, processedRequest, lockId, req, res, next, err) : next(err));
    };
  }

  _lockResource(req, operationType) {
    const plan_id = req.body.plan_id || req.query.plan_id;
    const plan = catalog.getPlan(plan_id);
    return Promise.try(() => {
      if (plan.manager.name === CONST.INSTANCE_TYPE.DIRECTOR) {
        // Acquire lock for this instance
        return lockManager.lock(req.params.instance_id, {
          lockedResourceDetails: {
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: req.params.instance_id,
            operation: operationType
          }
        }, plan);
      }
    });
  }

  _unlockIfReqfailed(operationType, processedRequest, lockId, req, res, next, err) {
    const plan_id = req.body.plan_id || req.query.plan_id;
    const plan = catalog.getPlan(plan_id);
    // If processed request
    return Promise
      .try(() => {
        _.set(req, 'params_copy', req.params);
        if (plan.manager.name === CONST.INSTANCE_TYPE.DIRECTOR) {
          if (processedRequest) {
            // if sf20 is enabled Check res status and unlock based on the request and status        
            if (
              operationType === CONST.OPERATION_TYPE.CREATE && res.statusCode === CONST.HTTP_STATUS_CODE.CONFLICT || // PutInstance => unlock in case of 409
              operationType === CONST.OPERATION_TYPE.DELETE && res.statusCode === CONST.HTTP_STATUS_CODE.GONE // DeleteInstance => unlock in case of 410
            ) {
              return lockManager.unlock(req.params.instance_id, lockId)
                .catch(unlockErr => next(unlockErr));
            }
          } else {
            return lockManager.unlock(req.params.instance_id, lockId)
              .then(() => {
                if (err) {
                  if (err instanceof ContinueWithNext) {
                    return process.nextTick(next);
                  }
                  return next(err);
                }
              })
              .catch(unlockErr => next(unlockErr));
          }
        } else {
          if (err) {
            if (err instanceof ContinueWithNext) {
              return process.nextTick(next);
            }
            return next(err);
          }
        }
      });
  }

  getConfigPropertyValue(name, defaultValue) {
    return _.get(config, name, defaultValue);
  }

  validateUuid(uuid, description) {
    if (!this.constructor.uuidPattern.test(uuid)) {
      throw new BadRequest(`Invalid ${description || 'uuid'} '${uuid}'`);
    }
  }

  validateRestoreTimeStamp(epochDateString) {
    // Here validating 
    // 1. Requested time stamp should be epoch millisecond.
    // 2. Requested time should not be older than 14(retention period) days
    const retentionMillis = config.backup.retention_period_in_days * 24 * 60 * 60 * 1000;
    const epochRequestDate = Number(epochDateString);
    if (!epochDateString ||
      isNaN(epochDateString) ||
      _.lt(new Date(epochRequestDate), new Date(Date.now() - retentionMillis))) {
      throw new BadRequest(`Date '${epochDateString}' is not epoch milliseconds or out of range of ${config.backup.retention_period_in_days} days.`);
    }
  }

  validateRestoreQuota(options) {
    return this.backupStore
      .getRestoreFile(options)
      .then(metdata => {
        let restoreDates = _.get(metdata, 'restore_dates.succeeded');
        if (!_.isEmpty(restoreDates)) {
          _.remove(restoreDates, date => {
            const dateTillRestoreAllowed = Date.now() - 1000 * 60 * 60 * 24 * config.backup.restore_history_days;
            return _.lt(new Date(date), new Date(dateTillRestoreAllowed));
          });
          //after removing all older restore, 'restoreDates' contains dates within allowed time
          // dates count should be less than 'config.backup.num_of_allowed_restores'
          if (restoreDates.length >= config.backup.num_of_allowed_restores) {
            throw new BadRequest(`Restore allowed only ${config.backup.num_of_allowed_restores} times within ${config.backup.restore_history_days} days.`);
          }
        }
      })
      .catch(NotFound, (err) => {
        logger.debug('Not found any restore data.', err);
        //Restore file might not be found, first time restore.
        return true;
      });
  }

  getInstanceId(deploymentName) {
    return _.nth(this.fabrik.DirectorManager.parseDeploymentName(deploymentName), 2);
  }

  // TODO: This piece of code should be removed; manager code should be imported from Service (Director/Docker) in broker code
  createManager(plan_id) {
    return this.fabrik.createManager(this.getPlan(plan_id));
  }

  getService(service_id) {
    return catalog.getService(service_id);
  }

  getPlan(plan_id) {
    return catalog.getPlan(plan_id);
  }
}

FabrikBaseController.uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
FabrikBaseController.k8sNamespacePattern = /^[0-9a-z\-]+$/i;

module.exports = FabrikBaseController;