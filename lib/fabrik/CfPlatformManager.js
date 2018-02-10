'use strict';

const Promise = require('bluebird');
const BasePlatformManager = require('./BasePlatformManager');
const utils = require('../utils');
const assert = require('assert');
const errors = require('../errors');
const cloudController = require('../cf').cloudController;
const logger = require('../logger');
const SecurityGroupNotCreated = errors.SecurityGroupNotCreated;
const SecurityGroupNotFound = errors.SecurityGroupNotFound;
const NotImplemented = errors.NotImplemented;
const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

class CfPlatformManager extends BasePlatformManager {
  constructor(guid, manager, context) {
    super(guid, manager, context);
    this.space_guid = context.space_guid;
    this.cloudController = cloudController;
  }

  preInstanceProvisionOperations(options) {
    /* jshint unused:false */
    throw new NotImplemented('preInstanceProvisionOperations');
  }

  postInstanceProvisionOperations(options) {
    return this.createSecurityGroup(this.space_guid, options.ruleId, options.ipRules);
  }

  preInstanceDeleteOperations(options) {
    return this.deleteSecurityGroup(options.ruleId);
  }

  postInstanceDeleteOperations(options) {
    /* jshint unused:false */
    throw new NotImplemented('postInstanceDeleteOperations');
  }

  createSecurityGroup(space_guid, name, rules) {
    logger.info(`Creating security group '${name}' with rules ...`, rules);
    return utils
      .retry(tries => {
        logger.info(`+-> ${ordinals[tries]} attempt to create security group '${name}'...`);
        return this.cloudController
          .createSecurityGroup(name, rules, [space_guid])
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

  ensureSecurityGroupExists(space_guid, name) {
    logger.info(`Ensuring existence of security group '${name}'...`);
    return this.cloudController
      .findSecurityGroupByName(name)
      .tap(() => logger.info('+-> Security group exists'))
      .catch(SecurityGroupNotFound, () => {
        logger.warn('+-> Security group does not exist. Trying to create it again.');
        return this.ensureTenantGuid(space_guid)
          .then(space_guid => this.createSecurityGroup(space_guid));
      });
  }

  deleteSecurityGroup(name) {
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

  ensureTenantId(space_guid) {
    return Promise
      .try(() => space_guid ? space_guid : this.cloudController
        .getServiceInstance(this.guid)
        .then(instance => instance.entity.space_guid)
      );
  }
}

module.exports = CfPlatformManager;