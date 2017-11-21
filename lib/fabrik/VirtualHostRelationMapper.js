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

    createVirtualHostRelation(deploymentName, propertyName, propertyValue) {
        this.cache[propertyName] = deploymentName;
        const data = {
            "propertyName": deploymentName,
            "instance_guid": propertyName
        };
        return this.virtualHostStore.putFile(data);
    }

    getDeploymentName(instanceId) {
        if (this.cache[instanceId] == null) {
            return this.loadCacheforInstance(instanceId);
        }
        return Promise.resolve(this.cache[instanceId]);
    }

    loadCacheforInstance(instanceId) {
        const data = { "instance_guid": instanceId };
        return this.virtualHostStore.getVirtualHostFile(data)
            .then((metadata) => {
                this.cache[metadata.instance_guid] = metadata.propertyName;
                return Promise.resolve(metadata.propertyName);
            });
    }

    deleteVirtualHostRelation(instanceId) {
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