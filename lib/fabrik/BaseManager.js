'use strict';

const formatUrl = require('url').format;
const _ = require('lodash');
const config = require('../config');
const errors = require('../errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const CONST = require('../constants');

class BaseManager {
  constructor(plan) {
    this.plan = plan;
  }

  get service() {
    return this.plan.service;
  }

  get subnet() {
    return this.settings.subnet || this.service.subnet;
  }

  get name() {
    return this.plan.manager.name;
  }

  get settings() {
    return this.plan.manager.settings;
  }

  get updatePredecessors() {
    return this.settings.update_predecessors || [];
  }

  isAutoUpdatePossible() {
    throw new NotImplementedBySubclass('isAutoUpdatePossible');
  }

  isUpdatePossible(plan_id) {
    const previousPlan = _.find(this.service.plans, ['id', plan_id]);
    return this.plan === previousPlan || _.includes(this.updatePredecessors, previousPlan.id);
  }

  getSecurityGroupName(guid) {
    return `${this.constructor.prefix}-${guid}`;
  }

  getDashboardUrl(guid) {
    return formatUrl(_
      .chain(config.external)
      .pick('protocol', 'host')
      .set('slashes', true)
      .set('pathname', `/manage/instances/${this.service.id}/${this.plan.id}/${guid}`)
      .value()
    );
  }

  createInstance(guid) {
    return new this.constructor.instanceConstructor(guid, this);
  }

  static get prefix() {
    return CONST.SERVICE_FABRIK_PREFIX;
  }

  static get instanceConstructor() {
    throw new NotImplementedBySubclass('instanceConstructor');
  }
}

module.exports = BaseManager;