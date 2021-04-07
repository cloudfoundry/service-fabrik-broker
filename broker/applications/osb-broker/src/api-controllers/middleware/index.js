'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const {
  CONST,
  errors: {
    PreconditionFailed,
    BadRequest,
    Forbidden,
    DeploymentAlreadyLocked,
    UnprocessableEntity,
    InvalidServiceParameters
  },
  commonFunctions
} = require('@sf/common-utils');
const Promise = require('bluebird');
const logger = require('@sf/logger');
const config = require('@sf/app-config');
const { catalog } = require('@sf/models');
const { lockManager, apiServerClient } = require('@sf/eventmesh');
const QuotaClient = require('./QuotaClient');

exports.validateCreateRequest = function () {
  return function (req, res, next) {
    /* jshint unused:false */
    if (!_.get(req.body, 'space_guid') || !_.get(req.body, 'organization_guid')) {
      return next(new BadRequest('This request is missing mandatory organization guid and/or space guid.'));
    }
    next();
  };
};

exports.validateMaintenanceInfoInRequest = function () {
  return function (req, res, next) {
    const reqMaintenanceInfoVersion = _.get(req, 'body.maintenance_info.version', '');
    if(reqMaintenanceInfoVersion === '') {
      return next();
    }
    const plan = getPlanFromRequest(req);
    if(!_.isEmpty(_.get(plan, 'maintenance_info', {}))) {
      const planMaintenanceInfoVersion = _.get(plan, 'maintenance_info.version');
      logger.info(`validating maintenance_info.version in request: ${reqMaintenanceInfoVersion} and in plan ${planMaintenanceInfoVersion}`);
      if(reqMaintenanceInfoVersion != planMaintenanceInfoVersion) {
        return next(new UnprocessableEntity('The maintenance information for the requested Service Plan has changed.', 'MaintenanceInfoConflict'));
      }
    }
    return next();
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

function supportsInstanceBasedQuota(service_id) {
  const serviceQuotaCheckType = _.get(catalog.getService(service_id), 'quota_check_type', 'instance');
  return serviceQuotaCheckType === 'instance';
}

exports.checkQuota = function () {
  return function (req, res, next) {
    if (!_.get(config.quota, 'enabled')) {
      logger.debug('Quota check is not enabled');
      next();
    } else if (commonFunctions.isServiceFabrikOperation(req.body)) {
      logger.debug('[Quota]: Check skipped as it is ServiceFabrikOperation: calling next handler..');
      next();
    } else {
      const orgId = req.body.organization_guid || req.body.context.organization_guid || _.get(req, 'body.previous_values.organization_id');
      const subaccountId = _.get(req, 'body.context.subaccount_id');
      if (orgId === undefined && subaccountId === undefined) {
        next(new BadRequest('organization_id and subaccountId are undefined'));
      } else {  
        const quotaClient = new QuotaClient({});
        const useAPIServerForConsumedQuotaCheck = !commonFunctions.isBrokerBoshDeployment();
        const quotaClientOptions = {
          subaccountId: subaccountId,
          queryParams: {
            planId: req.body.plan_id,
            previousPlanId: _.get(req, 'body.previous_values.plan_id'),
            useAPIServerForConsumedQuotaCheck: useAPIServerForConsumedQuotaCheck,
            orgId: orgId,
            reqMethod: req.method
          }
        };
        if(_.get(req.params, 'region') !== undefined) {
          _.set(quotaClientOptions.queryParams, 'region', req.params.region);
        }
        const instanceBasedQuota = supportsInstanceBasedQuota(req.body.service_id);
        if(!instanceBasedQuota) {
          quotaClientOptions.data = _.cloneDeep(req.body);
          _.set(quotaClientOptions.data, 'instance_id', req.params.instance_id);
        }
        return quotaClient.checkQuotaValidity(quotaClientOptions, instanceBasedQuota)
          .then(({ quotaValid, message }) => {
            const plan = getPlanFromRequest(req);
            logger.debug(`quota api response : ${quotaValid}`);
            if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED) {
              logger.error(`[QUOTA] Not entitled to create service instance: org '${req.body.organization_guid}', subaccount '${subaccountId}', service '${plan.service.name}', plan '${plan.name}'`);
              next(new Forbidden(message ? message : 'Not entitled to create service instance'));
            } else if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA) {
              logger.error(`[QUOTA] Quota is not sufficient for this request: org '${req.body.organization_guid}', subaccount '${subaccountId}', service '${plan.service.name}', plan '${plan.name}'`);
              next(new Forbidden(message ? message : 'Quota is not sufficient for this request'));
            } else {
              logger.debug('[Quota]: calling next handler..');
              next();
            }
          }).catch(err => {
            logger.error('[QUOTA]: exception occurred --', err);
            next(err);
          });
      }
    }
  };
};

exports.injectPlanInRequest = function() {
  return function (req, res, next) {
    /* jshint unused:false */
    return Promise.try(() => {
      const plan_id = req.body.plan_id || req.query.plan_id;
      if(!_.isEmpty(plan_id)) {
        next();
      } else {
        return apiServerClient.getResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
          resourceId: commonFunctions.getKubernetesName(req.params.instance_id)
        })
          .then(resource => {
            _.set(req, 'body.plan_id', _.get(resource, 'spec.planId'));
            logger.info(`injected plan_id ${req.body.plan_id} in request for instance ${req.params.instance_id}`);
          })
          .catch(err => {
            logger.warn(`resource could not be fetched for instance id ${req.params.instance_id}. Error: ${err}`);
          })
          .finally(() => next());
      }
    });
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

exports.validateConcurrentOperations = function() {
  return function (req, res, next) {
    return Promise.try(() => {
      if(_.get(config, 'allowConcurrentOperations', false) === true) {
        return next();
      } else {
        // Get sfserviceinstance resource
        // if the state is in_progress/in_queue/create/update/delete return 422
        return apiServerClient.getResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
          resourceId: commonFunctions.getKubernetesName(req.params.instance_id)
        })
          .then(resource => {
            const state = _.get(resource, 'status.state');
            logger.info(`Current state of the resource ${_.get(resource, 'metadata.name')} is ${state}`);
            if(state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE 
            || state === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS 
            || state === CONST.OPERATION.IN_PROGRESS
            || state === CONST.APISERVER.RESOURCE_STATE.UPDATE
            || state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
              return next(new UnprocessableEntity('Another operation for this Service Instance is in progress.', 'ConcurrencyError'));
            } else {
              return next();
            }  
          })
          .catch(err => {
            logger.error('Error while validating concurrent operations ', err);
            return next(err);
          });
      }      
    });
  };  
};

exports.validateConcurrentBindingOperations = function() {
  return function (req, res, next) {
    return Promise.try(() => {
      // check if non blocking config is set
      if(_.get(config, 'allowConcurrentBindingOperations', false) === true) {
        return next();
      } else {
        return apiServerClient.getResources({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
          namespaceId: apiServerClient.getNamespaceId(commonFunctions.getKubernetesName(req.params.instance_id)),
          query: {
            labelSelector: `instance_guid=${commonFunctions.getKubernetesName(req.params.instance_id)}`
          }
        })
          .then(resourcesList => {
            for(let i = 0; i < resourcesList.length; i++) {
              const state = _.get(resourcesList[i], 'status.state');
              if(state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE 
            || state === CONST.OPERATION.IN_PROGRESS
            || state === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
            || state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
                logger.warn(`Current state of the binding resource ${_.get(resourcesList[i], 'metadata.name')} is ${state}`);
                return next(new UnprocessableEntity('Another operation for this Service Instance is in progress.', 'ConcurrencyError'));
              }
            }
            return next();
          })
          .catch(err => {
            logger.error('Error while validating concurrent operations ', err);
            return next(err);
          });
      }  
    });
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

exports.minApiVersion = function (minVersion) {
  return function (req, res, next) {
    const version = _.get(req.headers, 'x-broker-api-version', '1.0');
    if(commonFunctions.compareVersions(version, minVersion) < 0) {
      return next(new PreconditionFailed(`At least Broker API version ${minVersion} is required.`));
    }
    next();
  };
};

exports.addRequestIdentityToResponse = function () {
  return function (req, res, next) {
    const requestIdentity = _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY);
    if(requestIdentity) {
      res.set('X-Broker-API-Request-Identity', requestIdentity);
    }
    next();
  };
};

Object.assign(module.exports, require('@sf/express-commons').middleware);
