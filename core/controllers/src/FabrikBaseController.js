'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('@sf/app-config');
const {
  CONST,
  errors: {
    ContinueWithNext,
    BadRequest
  },
  commonFunctions,
  serviceFlowMapper
} = require('@sf/common-utils');
const { catalog } = require('@sf/models');
const BaseController = require('./BaseController');

class FabrikBaseController extends BaseController {
  constructor() {
    super();
  }

  get serviceBrokerName() {
    return _.get(config, 'broker_name', 'service-fabrik-broker');
  }

  handleWithResourceLocking(func, operationType) {
    return (req, res, next) => {
      let resourceLocked = false;
      let processedRequest = false;
      let lockId, serviceFlowId, serviceFlowName;
      return Promise.try(() => {
        if (operationType === CONST.OPERATION_TYPE.UPDATE) {
          serviceFlowName = serviceFlowMapper.getServiceFlow(req.body);
          if (serviceFlowName !== undefined) {
            return commonFunctions.uuidV4()
              .tap(id => serviceFlowId = id);
          }
        }
        return undefined;
      })
        .then(serviceFlowId => this._lockResource(req, operationType, serviceFlowId))
        .tap(() => resourceLocked = true)
        .then(lockResourceId => {
          lockId = lockResourceId;
          const fn = _.isString(func) ? this[func] : func;
          if (serviceFlowId !== undefined) {
            req._serviceFlow = {
              id: serviceFlowId,
              name: serviceFlowName
            };
          }
          return fn.call(this, req, res);
        })
        .tap(() => processedRequest = true)
        .then(() => this._unlockIfReqfailed(operationType, processedRequest, lockId, req, res, next))
        .catch(err => resourceLocked ? this._unlockIfReqfailed(operationType, processedRequest, lockId, req, res, next, err) : next(err));
    };
  }

  _lockResource(req, operationType, serviceFlowId) {
    const plan_id = req.body.plan_id || req.query.plan_id;
    const plan = catalog.getPlan(plan_id);
    return Promise.try(() => {
      if (plan.manager.name === CONST.INSTANCE_TYPE.DIRECTOR) {
        const lockManager = require('@sf/eventmesh').lockManager;
        // Acquire lock for this instance
        return lockManager.lock(req.params.instance_id, {
          lockedResourceDetails: this._getLockResourceDetails(req, operationType, serviceFlowId)
        }, plan);
      }
    });
  }

  _getLockResourceDetails(req, operationType, serviceFlowId) {
    if (_.includes(CONST.OPERATION_TYPE.LIFECYCLE, operationType)) {
      if (serviceFlowId !== undefined) {
        return {
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
          resourceId: serviceFlowId,
          operation: `${operationType}_${CONST.OPERATION_TYPE.SERVICE_FLOW}`
        };
      }
      return {
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
        resourceId: req.params.instance_id,
        operation: operationType
      };
    }
  }

  _unlockIfReqfailed(operationType, processedRequest, lockId, req, res, next, err) {
    const plan_id = req.body.plan_id || req.query.plan_id;
    const plan = catalog.getPlan(plan_id);
    // If processed request
    return Promise
      .try(() => {
        _.set(req, 'params_copy', req.params);
        if (plan.manager.name === CONST.INSTANCE_TYPE.DIRECTOR) {
          const lockManager = require('@sf/eventmesh').lockManager;
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

  getService(service_id) {
    return catalog.getService(service_id);
  }

  getPlan(plan_id) {
    return catalog.getPlan(plan_id);
  }
}

FabrikBaseController.uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-useless-escape
FabrikBaseController.k8sNamespacePattern = /^[0-9a-z\-]+$/i;

module.exports = FabrikBaseController;
