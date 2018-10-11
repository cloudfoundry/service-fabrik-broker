'use strict';

const Promise = require('bluebird');
const logger = require('../../common/logger');
const bosh = require('../../data-access-layer/bosh');
const cloudController = require('../../data-access-layer/cf').cloudController;
const virtualHostStore = require('../../data-access-layer/iaas').virtualHostStore;

class VirtualHostRelationMapper {
  constructor() {
    this.cache = {};
    this.director = bosh.director;
    this.cloudController = cloudController;
    this.virtualHostStore = virtualHostStore;
  }

  createVirtualHostRelation(deploymentName, instanceId) {
    logger.info(`Storing deployment name : '${deploymentName}' for virtual_host instance id : '${instanceId}'`);
    this.cache[instanceId] = deploymentName;
    const data = {
      'deployment_name': deploymentName,
      'instance_guid': instanceId
    };
    return this.virtualHostStore.putFile(data);
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
    const options = {
      'instance_guid': instanceId
    };
    return this.virtualHostStore.getFile(options)
      .then((metadata) => {
        this.cache[metadata.instance_guid] = metadata.deployment_name;
        return metadata.deployment_name;
      });
  }

  deleteVirtualHostRelation(instanceId) {
    logger.info(`Deleting deployment name relation for virtual_host instance id : '${instanceId}'`);
    const options = {
      'instance_guid': instanceId
    };
    return this.virtualHostStore.removeFile(options)
      .then(() => this.deleteCacheEntry(instanceId));
  }

  deleteCacheEntry(instanceId) {
    return delete this.cache[instanceId];
  }
}
module.exports.VirtualHostRelationMapper = new VirtualHostRelationMapper();