'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('@sf/logger');
const { cloudController } = require('@sf/cf');
const config = require('@sf/app-config');
const { CONST } = require('@sf/common-utils');
const BaseQuotaManager = require('../BaseQuotaManager');

class CFPlatformQuotaManager extends BaseQuotaManager {
  constructor(quotaAPIClient) {
    super(quotaAPIClient, CONST.PLATFORM.CF);
  }

  async getInstanceCountonPlatform(orgId, planIds, region, instanceId) {
    const planGuids = await this.getAllPlanGuidsFromPlanIDs(planIds);
    logger.info('planguids to be checked are ', planGuids);
    logger.info('quota check for instance ', instanceId);
    let instances = await cloudController.getServiceInstancesInOrgWithPlansGuids(orgId, planGuids);
    if(instanceId && !_.isEmpty(instances)) {
      instances = _.filter(instances, instance => {
        return instance.metadata.guid !== instanceId;
      });  
    }
    return _.size(instances);
  }

  async isOrgWhitelisted(orgId) {
    const org = await cloudController.getOrganization(orgId);
    const orgLower = _.toLower(org.entity.name);
    logger.debug('current org details are ', org);
    logger.debug('current org name is ', orgLower);
    logger.debug('Whitelisted orgs are ', config.quota.whitelist);
    const whitelistEntry = _.find(config.quota.whitelist, o => {
      return o === orgLower;
    });
    return whitelistEntry !== undefined ? true : false;
  }

  async getAllPlanGuidsFromPlanIDs(planIds) {
    return await Promise.all(planIds.map(planId => this.getPlanGuidFromPlanID(planId)));
  }

  async getPlanGuidFromPlanID(planId) {
    const plans = await cloudController.getServicePlans(`unique_id:${planId}`);
    logger.debug(`planguid for uniqueid ${planId} is ${_.head(plans).metadata.guid}`);
    return _.head(plans).metadata.guid;
  }
}

module.exports = CFPlatformQuotaManager;
