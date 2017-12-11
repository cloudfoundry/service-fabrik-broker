'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const logger = require('../logger');
const utils = require('../utils');
const errors = require('../errors');
const cloudController = require('../cf').cloudController;
const serviceFabrikClient = require('../cf').serviceFabrikClient;
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const SecurityGroupNotCreated = errors.SecurityGroupNotCreated;
const SecurityGroupNotFound = errors.SecurityGroupNotFound;
const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

class BaseInstance {
  constructor(guid, manager) {
    this.guid = guid;
    this.manager = manager;
    this.cloudController = cloudController;
    this.serviceFabrikClient = serviceFabrikClient;
  }

  static get typeDescription() {
    return 'service instance';
  }

  get plan() {
    return this.manager.plan;
  }

  get service() {
    return this.manager.service;
  }

  get dashboardUrl() {
    return this.manager.getDashboardUrl(this.guid);
  }

  get securityGroupName() {
    return this.manager.getSecurityGroupName(this.guid);
  }

  isUpdatePossible(plan_id) {
    return this.manager.isUpdatePossible(plan_id);
  }

  createSecurityGroup(space_guid) {
    const name = this.securityGroupName;
    logger.info(`Building rules for security group '${name}'...`);
    return this.buildSecurityGroupRules()
      .tap(rules => logger.info('+-> Built security group rules:', rules))
      .then(rules => utils.retry(tries => {
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
      }))
      .then(securityGroup => securityGroup.metadata.guid)
      .tap(guid => logger.info(`+-> Created security group with guid '${guid}'`))
      .catch(err => {
        logger.error('+-> Failed to create security group');
        logger.error(err);
        throw new SecurityGroupNotCreated(name);
      });
  }

  ensureSecurityGroupExists(space_guid) {
    const name = this.securityGroupName;
    logger.info(`Ensuring existence of security group '${name}'...`);
    return this.cloudController
      .findSecurityGroupByName(name)
      .tap(() => logger.info('+-> Security group exists'))
      .catch(SecurityGroupNotFound, () => {
        logger.warn('+-> Security group does not exist. Trying to create it again.');
        return this.ensureSpaceGuid(space_guid)
          .then(space_guid => this.createSecurityGroup(space_guid));
      });
  }

  ensureSpaceGuid(space_guid) {
    return Promise
      .try(() => space_guid ? space_guid : this.cloudController
        .getServiceInstance(this.guid)
        .then(instance => instance.entity.space_guid)
      );
  }

  deleteSecurityGroup() {
    const name = this.securityGroupName;
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

  get async() {
    throw new NotImplementedBySubclass('async');
  }

  create(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('create');
  }

  update(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('update');
  }

  delete(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('delete');
  }

  lastOperation(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('lastOperation');
  }

  bind(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('bind');
  }

  unbind(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('unbind');
  }

  buildSecurityGroupRules() {
    throw new NotImplementedBySubclass('buildSecurityGroupRules');
  }
}

module.exports = BaseInstance;