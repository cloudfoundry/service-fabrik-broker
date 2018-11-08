'use strict';

const formatUrl = require('url').format;
const _ = require('lodash');
const config = require('../../../common/config');
const utils = require('../../../common/utils');
const errors = require('../../../common/errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const CONST = require('../../../common/constants');
const Promise = require('bluebird');

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

  get restorePredecessors() {
    return this.settings.restore_predecessors || this.updatePredecessors;
  }

  isUpdatePossible(plan_id) {
    const previousPlan = _.find(this.service.plans, ['id', plan_id]);
    return this.plan === previousPlan || _.includes(this.updatePredecessors, previousPlan.id);
  }

  isRestorePossible(plan_id) {
    return utils.isRestorePossible(plan_id, this.plan);
  }

  getSecurityGroupName(guid) {
    return `${this.constructor.prefix}-${guid}`;
  }

  getDashboardUrl(guid) {
    return formatUrl(_
      .chain(config.external)
      .pick('protocol', 'host')
      .set('slashes', true)
      .set('pathname', `/manage/dashboards/${this.plan.manager.name}/instances/${guid}`)
      .value()
    );
  }

  createInstance(guid, platformManager) {
    return new this.constructor.instanceConstructor(guid, this, platformManager);
  }

  static get prefix() {
    return CONST.SERVICE_FABRIK_PREFIX;
  }

  static get instanceConstructor() {
    throw new NotImplementedBySubclass('instanceConstructor');
  }

  static load(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }
}

module.exports = BaseManager;