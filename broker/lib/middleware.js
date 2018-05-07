'use strict';

const _ = require('lodash');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const quota = require('../lib/quota');
const quotaManager = quota.quotaManager;
const CONST = require('../../common/constants');
const Forbidden = errors.Forbidden;
const BadRequest = errors.BadRequest;
const utils = require('../../common/utils');
const catalog = require('./models/catalog');


exports.isFeatureEnabled = function (featureName) {
  return function (req, res, next) {
    if (!utils.isFeatureEnabled(featureName)) {
      throw new errors.ServiceUnavailable(`${featureName} feature not enabled`);
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