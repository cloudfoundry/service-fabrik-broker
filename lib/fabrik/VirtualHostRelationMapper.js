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

class VirtualHostRelationMapper {
    constructor() {
        this.cache = {};
        this.director = bosh.director;
        this.populateCache();
    }

    static get instanceConstructor() {
        return VirtualHostRelationMapper;
    }

    createOrUpdateDeploymentProperty(deploymentName, propertyName, propertyValue) {
        this.cache[propertyName] = deploymentName;
        return this.director
            .createOrUpdateDeploymentProperty(deploymentName, propertyName, propertyValue);
    }

    updateOrCreateDeploymentProperty(deploymentName, propertyName, propertyValue) {
        this.cache[propertyName] = deploymentName;
        return this.director
            .updateOrCreateDeploymentProperty(deploymentName, propertyName, propertyValue);
    }

    getDeploymentNamefromCache(propertyName) {
        var deploymentName = this.cache[propertyName];
        return new Promise.resolve(deploymentName)
    }

    deleteDeploymentProperty(propertyName) {
        return this.getDeploymentNamefromCache(propertyName)
            .then(deploymentName => { this.director.deleteDeploymentProperty(deploymentName, propertyName) })
            .tap(() => { this.deleteCacheEntry(propertyName) });
    }

    deleteCacheEntry(deploymentName) {
        return delete this.cache[deploymentName];
    }

    populateCache() {

    }
}
module.exports.VirtualHostRelationMapper = new VirtualHostRelationMapper;