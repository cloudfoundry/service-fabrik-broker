'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../../../common/logger');
const cf = require('../../../data-access-layer/cf');
const catalog = require('../../../common/models/catalog');
const config = require('../../../common/config');
const CONST = require('../../../common/constants');

class QuotaManager {
  constructor(quotaAPIClient) {
    this.quotaAPIClient = quotaAPIClient;
  }

  checkQuota(orgId, planId, previousPlanId, reqMethod) {
    return Promise.try(() => {
      if (!_.get(config.quota, 'enabled')) {
        logger.debug('Quota check is not enabled');
        return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
      } else if (CONST.HTTP_METHOD.PATCH === reqMethod && this.isSamePlanOrSkuUpdate(planId, previousPlanId)) {
        logger.debug('Quota check skipped as it is a normal instance update or plan update with same sku.');
        return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
      } else {
        return this.isOrgWhitelisted(orgId)
          .then(isWhitelisted => {
            if (isWhitelisted) {
              logger.debug('Org whitelisted, Quota check skipped');
              return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
            } else {
              logger.debug(`Org id is ${orgId}`);
              logger.debug(`Plan id is ${planId}`);
              let planName = _.find(catalog.plans, ['id', planId]).name;
              let serviceName = _.find(catalog.plans, ['id', planId]).service.name;
              let skipQuotaCheck = _.find(catalog.plans, ['id', planId]).metadata ? _.find(catalog.plans, ['id', planId]).metadata.skip_quota_check : undefined;
              logger.debug(`Plan Name is ${planName}`);
              logger.debug(`Service Name is ${serviceName}`);
              logger.debug(`Skip Quota check: ${skipQuotaCheck}`);
              if (skipQuotaCheck && skipQuotaCheck === true) {
                return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
              } else {
                const planIdsWithSameSKU = this.getAllPlanIdsWithSameSKU(planName, serviceName, catalog);
                return this.quotaAPIClient.getQuota(orgId, serviceName, planName)
                  .then(quota => {
                    // Special cases:
                    // When obtained quota = 0, send message to customer – Not entitled to create service instance
                    // When obtained quota = -1, assume that the org is whitelisted and hence allow the creation
                    if (quota === 0) {
                      return CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED;
                    } else if (quota === -1) {
                      return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
                    } else {
                      return this.getAllPlanGuidsFromPlanIDs(planIdsWithSameSKU)
                        .tap(planGuids => logger.debug('planguids are ', planGuids))
                        .then(planGuids => cf.cloudController.getServiceInstancesInOrgWithPlansGuids(orgId, planGuids))
                        .tap(instances => logger.debug(`Number of instances are ${_.size(instances)} & Quota number for current org space and service_plan is ${quota}`))
                        .then(instances => _.size(instances) >= quota ? CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA : CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA);
                    }
                  });
              }
            }
          });
      }
    });
  }

  getAllPlanIdsWithSameSKU(planName, serviceName, serviceCatalog) {
    return Promise.try(() => {
      const planManagerName = _.find(catalog.plans, ['name', planName]).manager.name;
      const skuName = this.getSkuNameForPlan(planName);

      logger.debug(`SKUName is ${skuName}`);
      const planIdsWithSameSKU = [];
      const service = _.find(serviceCatalog.services, ['name', serviceName]);
      _.each(service.plans, (plan) => {
        if (plan.name.endsWith(skuName) && plan.manager.name === planManagerName) {
          planIdsWithSameSKU.push(plan.id);
          logger.debug(`Found a plan with name as ${plan.name} which contains the skuName ${skuName}`);
        }
      });
      logger.debug('sameskuplanids are ', planIdsWithSameSKU);
      return planIdsWithSameSKU;
    });
  }

  isOrgWhitelisted(orgId) {
    return cf.cloudController.getOrganization(orgId)
      .tap(org => {
        logger.debug('current org details are ', org);
        logger.debug('current org name is ', org.entity.name);
        logger.debug('Whitelisted orgs are ', config.quota.whitelist);
      })
      .then(org => _.includes(config.quota.whitelist, org.entity.name));
  }

  getAllPlanGuidsFromPlanIDs(planIds) {
    return Promise.map(planIds, planId => this.getPlanGuidFromPlanID(planId));
  }

  getPlanGuidFromPlanID(planId) {
    return cf.cloudController.getServicePlans(`unique_id:${planId}`)
      .tap(plans => logger.debug(`planguid for uniqueid ${planId} is ${_.head(plans).metadata.guid}`))
      .then(plans => _.head(plans).metadata.guid);
  }

  isSamePlanOrSkuUpdate(planId, previousPlanId) {
    return previousPlanId === undefined || planId === undefined || previousPlanId === planId || this.getSkuNameForPlan(_.find(catalog.plans, ['id', previousPlanId]).name) === this.getSkuNameForPlan(_.find(catalog.plans, ['id', planId]).name);
  }

  getSkuNameForPlan(planName) {
    const firstIdx = planName.indexOf('-'); // assumption here is that service plan names are versioned, and the format is like <version>-{...}-<tshirt-size>
    return planName.substring(planName.indexOf('-', firstIdx)); // and skuName will be only -{...}-<tshirt-size>
  }
}

module.exports = QuotaManager;