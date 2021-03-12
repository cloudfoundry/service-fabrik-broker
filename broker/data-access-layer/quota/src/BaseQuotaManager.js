'use strict';

const _ = require('lodash');
const {
  CONST,
  errors: { NotImplementedBySubclass }
} = require('@sf/common-utils');
const logger = require('@sf/logger');
const { catalog } = require('@sf/models');

class BaseQuotaManager {
  constructor(quotaAPIClient, platform) {
    this.quotaAPIClient = quotaAPIClient;
    this.platform = platform;
  }

  async checkQuota(subaccountId, orgId, planId, previousPlanId, reqMethod, useAPIServerForConsumedQuotaCheck, region) {
    if (CONST.HTTP_METHOD.PATCH === reqMethod && this.isSamePlanOrSkuUpdate(planId, previousPlanId)) {
      logger.debug('Quota check skipped as it is a normal instance update or plan update with same sku.');
      return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
    } else if (await this.isOrgWhitelisted(orgId)) {
      logger.debug('Org whitelisted, Quota check skipped');
      return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
    } else {
      logger.debug(`Platform is ${this.platform}`);
      logger.debug(`Subaccount id is ${subaccountId}`);
      logger.debug(`Org ID is ${orgId}`);
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
        const quota = await this.quotaAPIClient.getQuota(subaccountId, serviceName, planName);
        // Special cases:
        // When obtained quota = 0, send message to customer – Not entitled to create service instance
        // When obtained quota = -1, assume that the org is whitelisted and hence allow the creation
        if (quota === 0) {
          return CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED;
        } else if (quota === -1) {
          return CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
        } else {
          const planIdsWithSameSKU = this.getAllPlanIdsWithSameSKU(planName, serviceName, catalog);
          const instanceCount = await this.getInstanceCountonPlatform(useAPIServerForConsumedQuotaCheck ? subaccountId : orgId, planIdsWithSameSKU, region);
          logger.debug(`Number of instances are ${instanceCount} & Quota number for current org space and service_plan is ${quota}`);
          return instanceCount >= quota ? CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA : CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA;
        }
      }
    }
  }
  async getInstanceCountonPlatform(orgOrSubaccountId, planGuids, region) {
    throw new NotImplementedBySubclass(`getInstanceCountonPlatform - ${orgOrSubaccountId}, ${planGuids}`);
  }
  getAllPlanIdsWithSameSKU(planName, serviceName, serviceCatalog) {
    const planManagerName = _.find(catalog.plans, ['name', planName]).manager.name;
    const skuName = this.getSkuNameForPlan(planName);

    logger.debug(`SKUName is ${skuName}`);
    const planIdsWithSameSKU = [];
    const service = _.find(serviceCatalog.services, ['name', serviceName]);
    _.each(service.plans, plan => {
      if (plan.name.endsWith(skuName) && plan.manager.name === planManagerName) {
        planIdsWithSameSKU.push(plan.id);
        logger.debug(`Found a plan with name as ${plan.name} which contains the skuName ${skuName}`);
      }
    });
    logger.debug('sameskuplanids are ', planIdsWithSameSKU);
    return planIdsWithSameSKU;
  }

  async isOrgWhitelisted(orgId) {
    return false;
  }

  isSamePlanOrSkuUpdate(planId, previousPlanId) {
    return previousPlanId === undefined || planId === undefined || previousPlanId === planId || this.getSkuNameForPlan(_.find(catalog.plans, ['id', previousPlanId]).name) === this.getSkuNameForPlan(_.find(catalog.plans, ['id', planId]).name);
  }

  getSkuNameForPlan(planName) {
    const firstIdx = planName.indexOf('-'); // assumption here is that service plan names are versioned, and the format is like <version>-{...}-<tshirt-size>
    return planName.substring(planName.indexOf('-', firstIdx)); // and skuName will be only -{...}-<tshirt-size>
  }

}

module.exports = BaseQuotaManager;
