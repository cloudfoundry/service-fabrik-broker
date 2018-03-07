'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const BasePlatformManager = require('./BasePlatformManager');
const utils = require('../utils');
const assert = require('assert');
const errors = require('../errors');
const cloudController = require('../cf').cloudController;
const logger = require('../logger');
const CONST = require('../constants');
const SecurityGroupNotCreated = errors.SecurityGroupNotCreated;
const SecurityGroupNotFound = errors.SecurityGroupNotFound;
const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

class CfPlatformManager extends BasePlatformManager {
  constructor(platform) {
    super(platform);
    this.cloudController = cloudController;
  }

  getSecurityGroupName(guid) {
    return `${CONST.SERVICE_FABRIK_PREFIX}-${guid}`;
  }

  postInstanceProvisionOperations(options) {
    return this.createSecurityGroup(options);
  }

  preInstanceDeleteOperations(options) {
    return this.deleteSecurityGroup(options);
  }

  postInstanceUpdateOperations(options) {
    return this.ensureSecurityGroupExists(options);
  }

  createSecurityGroup(options) {
    const name = this.getSecurityGroupName(options.guid);
    const rules = _.map(options.ruleOptions, opts => this.buildSecurityGroupRules(opts));
    logger.info(`Creating security group '${name}' with rules ...`, rules);
    return utils
      .retry(tries => {
        logger.info(`+-> ${ordinals[tries]} attempt to create security group '${name}'...`);
        return this.cloudController
          .createSecurityGroup(name, rules, [options.context.space_guid])
          .catch(err => {
            logger.error(err);
            throw err;
          });
      }, {
        maxAttempts: 4,
        minDelay: 1000
      })
      .then(securityGroup => securityGroup.metadata.guid)
      .tap(guid => logger.info(`+-> Created security group with guid '${guid}'`))
      .catch(err => {
        logger.error(`+-> Failed to create security group ${name}`);
        logger.error(err);
        throw new SecurityGroupNotCreated(name);
      });
  }

  ensureSecurityGroupExists(options) {
    const name = this.getSecurityGroupName(options.guid);
    logger.info(`Ensuring existence of security group '${name}'...`);
    return this.cloudController
      .findSecurityGroupByName(name)
      .tap(() => logger.info('+-> Security group exists'))
      .catch(SecurityGroupNotFound, () => {
        logger.warn('+-> Security group does not exist. Trying to create it again.');
        return this.ensureTenantId(options.context.space_guid)
          .then(() => this.createSecurityGroup(options.ruleOptions));
      });
  }

  deleteSecurityGroup(options) {
    const name = this.getSecurityGroupName(options.guid);
    logger.info(`Deleting security group '${name}'...`);
    return this.cloudController
      .findSecurityGroupByName(name)
      .tap(securityGroup => assert.strictEqual(securityGroup.entity.name, name))
      .then(securityGroup => securityGroup.metadata.guid)
      .tap(guid => logger.info(`+-> Found security group with guid '${guid}'`))
      .then(guid => this.cloudController.deleteSecurityGroup(guid))
      .tap(() => logger.info('+-> Deleted security group'))
      .catch(SecurityGroupNotFound, err => {
        logger.warn('+-> Could not find security group');
        logger.warn(err);
      }).catch(err => {
        logger.error('+-> Failed to delete security group');
        logger.error(err);
        throw err;
      });
  }

  ensureTenantId(options) {
    return Promise
      .try(() => options.context.space_guid ? options.context.space_guid : this.cloudController
        .getServiceInstance(options.guid)
        .then(instance => instance.entity.space_guid)
      );
  }

  buildSecurityGroupRules(options) {
    return {
      protocol: options.protocol,
      destination: _.size(options.ips) === 1 ? `${_.first(options.ips)}` : `${_.first(options.ips)}-${_.last(options.ips)}`,
      ports: _.size(options.ports) === 1 ? `${_.first(options.ports)}` : `${_.first(options.ports)}-${_.last(options.ports)}`
    };
  }
}

module.exports = CfPlatformManager;