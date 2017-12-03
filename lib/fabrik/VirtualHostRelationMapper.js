'use strict';

const parseUrl = require('url').parse;
const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const errors = require('../errors');
const Timeout = errors.Timeout;
const logger = require('../logger');
const utils = require('../utils');
const CONST = require('../constants');
const bosh = require('../bosh');
const BoshDirectorClient = bosh.BoshDirectorClient;
const cf = require('../cf');
const cloudController = require('../cf').cloudController;
const catalog = require('../models/catalog');
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
            "deployment_name": deploymentName,
            "instance_guid": instanceId
        };
        return this.virtualHostStore.putFile(data);
    }

    getDeploymentName(instanceId) {
        logger.info(`Fetching deployment name for virtual_host instance id : '${instanceId}'`);
        if (this.cache[instanceId] == null) {
            logger.info(`Cache miss for deployment name for virtual_host instance id ${instanceId}, Will load it from store.`);
            return this.loadCacheforInstance(instanceId);
        }
        return Promise.resolve(this.cache[instanceId]);
    }

    loadCacheforInstance(instanceId) {
        const data = { "instance_guid": instanceId };
        return this.virtualHostStore.getVirtualHostFile(data)
            .then((metadata) => {
                this.cache[metadata.instance_guid] = metadata.deployment_name;
                return Promise.resolve(metadata.deployment_name);
            });
    }

    deleteVirtualHostRelation(instanceId) {
        logger.info(`Deleting deployment name relation for virtual_host instance id : '${instanceId}'`);
        const data = { "instance_guid": instanceId };
        return this.virtualHostStore.removeFile(data)
            .then(() => {
                this.deleteCacheEntry(instanceId)
            });
    }

    deleteCacheEntry(instanceId) {
        return delete this.cache[instanceId];
    }
}
module.exports.VirtualHostRelationMapper = new VirtualHostRelationMapper;