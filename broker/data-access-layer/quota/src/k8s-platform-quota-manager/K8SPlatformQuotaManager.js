'use strict';

const _ = require('lodash');
const { CONST } = require('@sf/common-utils');
const BaseQuotaManager = require('../BaseQuotaManager');
const { apiServerClient } = require('@sf/eventmesh');

class K8SPlatformQuotaManager extends BaseQuotaManager {
  constructor(quotaAPIClient) {
    super(quotaAPIClient, CONST.PLATFORM.K8S);
  }
  
  async getInstanceCountonPlatform(subaccountId, planIds, region, instanceId) {
    const labelString = (region == undefined) ? `subaccount_id in (${subaccountId}),plan_id in (${planIds.toString()})` : `subaccount_id in (${subaccountId}),plan_id in (${planIds.toString()}), region in (${region})`;
    const instances = await apiServerClient.getResources({
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
