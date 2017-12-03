'use strict';

const Promise = require('bluebird');
const logger = require('../logger');
const bosh = require('../bosh');
const cloudController = require('../cf').cloudController;
const virtualHostStore = require('../iaas').virtualHostStore;

class VirtualHostRelationMapper {
    constructor() {
        this.cache = {};
        this.director = bosh.director;
        this.cloudController = cloudController;
        this.virtualHostStore = virtualHostStore;
    }

    static get instanceConstructor() {
        return VirtualHostRelationMapper;
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
        logger.info(`Fetching deployment name for virtual_host instance id : '${instanceId}'`);
        if (this.cache[instanceId] === undefined) {
            logger.info(`Cache miss for deployment name for virtual_host instance id ${instanceId}, Will load it from store.`);
            return this.loadCacheforInstance(instanceId);
        }
        return Promise.resolve(this.cache[instanceId]);
    }

    loadCacheforInstance(instanceId) {
        const data = { 'instance_guid': instanceId };
        return this.virtualHostStore.getVirtualHostFile(data)
            .then((metadata) => {
                this.cache[metadata.instance_guid] = metadata.deployment_name;
                return Promise.resolve(metadata.deployment_name);
            });
    }

    deleteVirtualHostRelation(instanceId) {
        logger.info(`Deleting deployment name relation for virtual_host instance id : '${instanceId}'`);
        const data = { 'instance_guid': instanceId };
        return this.virtualHostStore.removeFile(data)
            .then(() => {
                this.deleteCacheEntry(instanceId);
            });
    }

    deleteCacheEntry(instanceId) {
        return delete this.cache[instanceId];
    }
}
module.exports.VirtualHostRelationMapper = new VirtualHostRelationMapper();