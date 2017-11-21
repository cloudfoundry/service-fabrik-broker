'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const path = require('path');
const moment = require('moment');
const errors = require('../errors');
const logger = require('../logger');
const CONST = require('../constants');
const catalog = require('../models/catalog');
const config = require('../config');
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const UnprocessableEntity = errors.UnprocessableEntity;
const Forbidden = errors.Forbidden;
const Gone = errors.Gone;

class VirtualHostStore {

    constructor(cloudProvider) {
        this.cloudProvider = cloudProvider;
        const keys = {
            virtualHost: [
                'instance_guid'
            ]
        };
        const root = 'virtual_hosts';
        this.filename = new Filename(keys, root);
    }

    get containerName() {
        return this.cloudProvider.containerName;
    }

    get containerPrefix() {
        return _.nth(/^(.+)-broker$/.exec(this.containerName), 1);
    }

    getVirtualHostFile(data) {
        const filename = this.filename.stringify(data);
        return this.cloudProvider.downloadJson(filename);
    }

    putFile(data) {
        const filename = this.filename.stringify(data);
        return this.cloudProvider
            .uploadJson(filename, data)
            .return(data);
    }

    removeFile(data) {
        const filename = this.filename.stringify(data);
        return this.cloudProvider.remove(filename);
    }

}

class Filename {

    constructor(keys, root) {
        this.keys = keys;
        this.root = root;
    }

    stringify(metadata) {
        const instance_guid = metadata.instance_guid;
        const operation = "virtualHost";
        const basename = _
            .chain(this.keys)
            .get(operation)
            .map(key => {
                return metadata[key];
            })
            .join('.')
            .value() + '.json';
        return path.posix.join(
            this.root,
            instance_guid,
            basename
        );
    }

    isoDate(date) {
        //returns ISO Date string stripping out seconds
        return new Date(date || Date.now())
            .toISOString()
            .replace(/\.\d*/, '');
    }
}

module.exports = VirtualHostStore;