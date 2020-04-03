'use strict';

const _ = require('lodash');
const CONST = require('../../common/constants');
const BaseQuotaManager = require('../BaseQuotaManager');
const apiserverClient = require('../../data-access-layer/eventmesh').apiServerClient;

class K8SPlatformQuotaManager extends BaseQuotaManager {
  constructor(quotaAPIClient) {
    super(quotaAPIClient, CONST.PLATFORM.K8S);
  }
  
  async getInstanceCountonPlatform(subaccountId, planIds) {
    const labelString = `subaccount_id in (${subaccountId}),plan_id in (${planIds.toString()})`;
    const instances = await apiserverClient.getResources({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
      query: {
        labelSelector: labelString
      },
      allNamespaces: true
    });
    return _.size(instances); 
  }
}

module.exports = K8SPlatformQuotaManager;
