'use strict';

const Promise = require('bluebird');
const logger = require('@sf/logger');
const { CONST } = require('@sf/common-utils');
const { apiServerClient } = require('@sf/eventmesh');

class VirtualHostRelationMapper {
  constructor() {
    this.cache = {};
  }

  createVirtualHostRelation(deploymentName, instanceId) {
    logger.info(`Storing deployment name : '${deploymentName}' for virtual_host instance id : '${instanceId}'`);
    this.cache[instanceId] = deploymentName;
    return apiServerClient.patchResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST,
      resourceId: instanceId,
      operatorMetadata: {
        deploymentName: deploymentName
      }
    });
  }

  getDeploymentName(instanceId) {
    return Promise.try(() => {
      logger.info(`Fetching deployment name for virtual_host instance id : '${instanceId}'`);
      if (this.cache[instanceId] === undefined) {
        logger.info(`Cache miss for deployment name for virtual_host instance id ${instanceId}, Will load it from store.`);
        return this.loadCacheforInstance(instanceId);
      }
      return this.cache[instanceId];
    });
  }

  loadCacheforInstance(instanceId) {
    return apiServerClient.getResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST,
      resourceId: instanceId
    })
      .then(resourceBody => {
        this.cache[instanceId] = resourceBody.operatorMetadata.deploymentName;
        return resourceBody.operatorMetadata.deploymentName;
      });
  }

  deleteVirtualHostRelation(instanceId) {
    logger.info(`Deleting deployment name relation for virtual_host instance id : '${instanceId}'`);
    return this.deleteCacheEntry(instanceId);
  }

  deleteCacheEntry(instanceId) {
    return delete this.cache[instanceId];
  }
}
module.exports.VirtualHostRelationMapper = new VirtualHostRelationMapper();
