'use strict';

const _ = require('lodash');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const quota = require('../lib/quota');
const quotaManager = quota.quotaManager;
const Forbidden = errors.Forbidden;
const BadRequest = errors.BadRequest;
const utils = require('../../common/utils');
const catalog = require('./models/catalog');
const lockManager = require('../../eventmesh').lockManager;
const CONST = require('./../../common/constants');
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
const UnprocessableEntity = errors.UnprocessableEntity;


exports.isFeatureEnabled = function (featureName) {
  return function (req, res, next) {
    if (!utils.isFeatureEnabled(featureName)) {
      throw new errors.ServiceUnavailable(`${featureName} feature not enabled`);
    }
    next();
  };
};

exports.validateRequest = function () {
  return function (req, res, next) {
    /* jshint unused:false */
    if (req.instance.async && (_.get(req, 'query.accepts_incomplete', 'false') !== 'true')) {
      return next(new UnprocessableEntity('This request requires client support for asynchronous service operations.', 'AsyncRequired'));
    }
    next();
  };
};

exports.validateCreateRequest = function () {
  return function (req, res, next) {
    /* jshint unused:false */
    if (!_.get(req.body, 'space_guid') || !_.get(req.body, 'organization_guid')) {
      return next(new BadRequest('This request is missing mandatory organization guid and/or space guid.'));
    }
    next();
  };
};

exports.lock = function (operationType, lastOperationCall) {
  return function (req, res, next) {
    if (req.manager.name === CONST.INSTANCE_TYPE.DIRECTOR) {
      // Acquire lock for this instance
      return lockManager.lock(req.params.instance_id, {
          lockedResourceDetails: {
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: req.params.instance_id,
            operation: operationType ? operationType : utils.decodeBase64(req.query.operation).type // This is for the last operation call
          }
        })
        .then(() => next())
        .catch((err) => {
          logger.debug('[LOCK]: exception occurred; Need not worry as lock is probably set --', err);
          //For last operation call, we ensure migration of locks through this
          if (lastOperationCall && err instanceof DeploymentAlreadyLocked) {
            logger.info(`Proceeding as lock is already acquired for the resource: ${req.params.instance_id}`);
            next();
          } else {
            next(err);
          }
        });
    }
    next();
  };
};

exports.checkBlockingOperationInProgress = function () {
  return function (req, res, next) {
    if (req.manager.name === CONST.INSTANCE_TYPE.DIRECTOR) {
      // Acquire lock for this instance
      return lockManager.checkWriteLockStatus(req.params.instance_id)
        .then(writeLockStatus => {
          if (writeLockStatus.isWriteLocked) {
            next(new DeploymentAlreadyLocked(req.params.instance_id, undefined, `Resource ${req.params.instance_id} is write locked for ${writeLockStatus.lockDetails.lockedResourceDetails.operation} at ${writeLockStatus.lockDetails.lockTime}`));
          } else {
            next();
          }
        })
        .catch((err) => {
          logger.error('[LOCK]: exception occurred --', err);
          next(err);
        });
    }
    next();
  };
};

exports.checkQuota = function () {
  return function (req, res, next) {
    if (utils.isServiceFabrikOperation(req.body)) {
      logger.debug('[Quota]: Check skipped as it is ServiceFabrikOperation: calling next handler..');
      next();
    } else {
      const platform = _.get(req, 'body.context.platform');
      if (platform === CONST.PLATFORM.CF) {
        const orgId = req.body.organization_guid || req.body.context.organization_guid || _.get(req, 'body.previous_values.organization_id');
        if (orgId === undefined) {
          next(new BadRequest(`organization_id is undefined`));
        } else {
          return quotaManager.checkQuota(orgId, req.body.plan_id, _.get(req, 'body.previous_values.plan_id'), req.method)
            .then(quotaValid => {
              logger.debug(`quota api response : ${quotaValid}`);
              if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED) {
                logger.error(`[QUOTA] Not entitled to create service instance: org '${req.body.organization_guid}', service '${req.instance.service.name}', plan '${req.instance.plan.name}'`);
                next(new Forbidden(`Not entitled to create service instance`));
              } else if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA) {
                logger.error(`[QUOTA] Quota is not sufficient for this request: org '${req.body.organization_guid}', service '${req.instance.service.name}', plan '${req.instance.plan.name}'`);
                next(new Forbidden(`Quota is not sufficient for this request`));
              } else {
                logger.debug('[Quota]: calling next handler..');
                next();
              }
            }).catch((err) => {
              logger.error('[QUOTA]: exception occurred --', err);
              next(err);
            });
        }
      } else {
        logger.debug(`[Quota]: Platform: ${platform}. Not ${CONST.PLATFORM.CF}. Skipping quota check : calling next handler..`);
        next();
      }
    }
  };
};

exports.isPlanDeprecated = function () {
  return function (req, res, next) {
    if (checkIfPlanDeprecated(req.body.plan_id)) {
      logger.error(`Service instance with the requested plan with id : '${req.body.plan_id}' cannot be created as it is deprecated.`);
      throw new Forbidden(`Service instance with the requested plan cannot be created as it is deprecated.`);
    }
    next();
  };
};

function checkIfPlanDeprecated(plan_id) {
  const plan_state = _.get(catalog.getPlan(plan_id), 'metadata.state', CONST.STATE.ACTIVE);
  return plan_state === CONST.STATE.DEPRECATED;
}