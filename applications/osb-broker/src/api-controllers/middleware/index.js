'use strict';

const Ajv = require('ajv');
const {
  CONST,
  errors: {
    BadRequest,
    Forbidden,
    DeploymentAlreadyLocked
  },
  commonFunctions
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const { catalog } = require('@sf/models');
const { lockManager } = require('@sf/eventmesh');

exports.validateCreateRequest = function () {
  return function (req, res, next) {
    /* jshint unused:false */
    if (!_.get(req.body, 'space_guid') || !_.get(req.body, 'organization_guid')) {
      return next(new BadRequest('This request is missing mandatory organization guid and/or space guid.'));
    }
    next();
  };
};

  
function checkIfPlanDeprecated(plan_id) {
  const plan_state = _.get(catalog.getPlan(plan_id), 'metadata.state', CONST.STATE.ACTIVE);
  return plan_state === CONST.STATE.DEPRECATED;
}

exports.isPlanDeprecated = function () {
  return function (req, res, next) {
    if (checkIfPlanDeprecated(req.body.plan_id)) {
      logger.error(`Service instance with the requested plan with id : '${req.body.plan_id}' cannot be created as it is deprecated.`);
      throw new Forbidden('Service instance with the requested plan cannot be created as it is deprecated.');
    }
    next();
  };
};

  
exports.checkQuota = function () {
  function shouldCheckQuotaForPlatform(platform, origin) {
    return (platform === CONST.PLATFORM.CF ||
        (platform === CONST.PLATFORM.SM &&
          origin === CONST.PLATFORM.CF));
  }
  return function (req, res, next) {
    if (!_.get(config.quota, 'enabled')) {
      logger.debug('Quota check is not enabled');
      next();
    } else if (commonFunctions.isServiceFabrikOperation(req.body)) {
      logger.debug('[Quota]: Check skipped as it is ServiceFabrikOperation: calling next handler..');
      next();
    } else {
      const platform = _.get(req, 'body.context.platform');
      const origin = _.get(req, 'body.context.origin');
      if (shouldCheckQuotaForPlatform(platform, origin)) {
        const orgId = req.body.organization_guid || req.body.context.organization_guid || _.get(req, 'body.previous_values.organization_id');
        if (orgId === undefined) {
          next(new BadRequest('organization_id is undefined'));
        } else {
          const { quotaManager } = require('@sf/quota');
          return quotaManager.checkQuota(orgId, req.body.plan_id, _.get(req, 'body.previous_values.plan_id'), req.method)
            .then(quotaValid => {
              const plan = getPlanFromRequest(req);
              logger.debug(`quota api response : ${quotaValid}`);
              if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED) {
                logger.error(`[QUOTA] Not entitled to create service instance: org '${req.body.organization_guid}', service '${plan.service.name}', plan '${plan.name}'`);
                next(new Forbidden('Not entitled to create service instance'));
              } else if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA) {
                logger.error(`[QUOTA] Quota is not sufficient for this request: org '${req.body.organization_guid}', service '${plan.service.name}', plan '${plan.name}'`);
                next(new Forbidden('Quota is not sufficient for this request'));
              } else {
                logger.debug('[Quota]: calling next handler..');
                next();
              }
            }).catch(err => {
              logger.error('[QUOTA]: exception occurred --', err);
              next(err);
            });
        }
      } else {
        logger.debug(`[Quota]: Platform: ${platform}, Origin: ${origin}. Platform is not ${CONST.PLATFORM.CF} or ${CONST.PLATFORM.SM}/${CONST.PLATFORM.CF}. Skipping quota check : calling next handler..`);
        next();
      }
    }
  };
};

function getPlanFromRequest(req) {
  const plan_id = req.body.plan_id || req.query.plan_id;
  return catalog.getPlan(plan_id);
}

  
exports.validateRequest = function () {
  return function (req, res, next) {
    /* jshint unused:false */
    const plan = getPlanFromRequest(req);
    if (plan.manager.async && (_.get(req, 'query.accepts_incomplete', 'false') !== 'true')) {
      return next(new UnprocessableEntity('This request requires client support for asynchronous service operations.', 'AsyncRequired'));
    }
    next();
  };
};

exports.validateSchemaForRequest = function (target, operation) {
  return function (req, res, next) {
    const plan = getPlanFromRequest(req);
  
    const schema = _.get(plan, `schemas.${target}.${operation}.parameters`);
  
    if (schema) {
      const parameters = _.get(req, 'body.parameters', {});
  
      const schemaVersion = schema.$schema || '';
      const validator = new Ajv({ schemaId: 'auto' });
      if (schemaVersion.includes('draft-06')) {
        validator.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'));
      } else if (schemaVersion.includes('draft-04')) {
        validator.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'));
      } else if (!schemaVersion.includes('draft-07')) {
        validator.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'));
        validator.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'));
      }
      const validate = validator.compile(schema);
  
      const isValid = validate(parameters);
      if (!isValid) {
        const reason = _.map(validate.errors, ({ dataPath, message }) => `${dataPath} ${message}`).join(', ');
        return next(new InvalidServiceParameters(`Failed to validate service parameters, reason: ${reason}`));
      }
    }
    next();
  };
};

exports.checkBlockingOperationInProgress = function () {
  return function (req, res, next) {
    const plan_id = req.body.plan_id || req.query.plan_id;
    const plan = catalog.getPlan(plan_id);
    if (plan.manager.name === CONST.INSTANCE_TYPE.DIRECTOR) {
      // Acquire lock for this instance
      return lockManager.checkWriteLockStatus(req.params.instance_id)
        .then(writeLockStatus => {
          if (writeLockStatus.isWriteLocked) {
            next(new DeploymentAlreadyLocked(req.params.instance_id, undefined, `Resource ${req.params.instance_id} is write locked for ${writeLockStatus.lockDetails.lockedResourceDetails.operation} at ${writeLockStatus.lockDetails.lockTime}`));
          } else {
            next();
          }
        })
        .catch(err => {
          logger.error('[LOCK]: exception occurred --', err);
          next(err);
        });
    }
    next();
  };
};

Object.assign(module.exports, require('@sf/express-commons').middleware);
