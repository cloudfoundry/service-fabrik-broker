'use strict';

const errors = require('../errors');
const cloudController = require('../cf').cloudController;
const serviceFabrikClient = require('../cf').serviceFabrikClient;
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

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

  buildIpRules() {
    throw new NotImplementedBySubclass('buildIpRules');
  }

  assignPlatformManager() {
    throw new NotImplementedBySubclass('assignPlatformManager');
  }
}

module.exports = BaseInstance;