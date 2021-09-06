'use strict';

const _ = require('lodash');
const config = require('@sf/app-config');
const {
  errors: {
    ServiceNotFound,
    ServicePlanNotFound
  }
} = require('@sf/common-utils');
const Service = require('./Service');

class Catalog {
  constructor() {
    this.services = _.map(config.services, service => new Service(service));
    this.plans = _.flatMap(this.services, service => service.plans);
  }

  reload() {
    this.services = _.map(config.services, service => new Service(service));
    this.plans = _.flatMap(this.services, service => service.plans);
  }

  getPlan(id) {
    const plan = _.find(this.plans, plan => plan.id === id);
    if (!plan) {
      throw new ServicePlanNotFound(id);
    }
    return plan;
  }

  getService(id) {
    const service = _.find(this.services, ['id', id]);
    if (!service) {
      throw new ServiceNotFound(id);
    }
    return service;
  }

  getServiceName(id) {
    return this.getService(id).name;
  }

  getServiceFromPlan(planId) {
    for(const service of this.services) {
      let plan = _.find(service.plans, plan => plan.id === planId);
      if (plan) {
        return service;
      }
    }
    throw new ServicePlanNotFound(planId);
  }

  toJSON() {
    return {
      services: _.filter(this.services, service => service.name.indexOf('-fabrik-internal') === -1)
    };
  }

  getPlanSKUFromPlanGUID(serviceGuid, planGuid) {
    const service = _.chain(this.toJSON().services)
      .map(s => s.id === serviceGuid ? s : undefined)
      .filter(s => s !== undefined)
      .head()
      .value();
    return _
      .chain(service.plans)
      .map(p => p.id === planGuid ? p.sku_name : undefined)
      .filter(p => p !== undefined)
      .head()
      .value();
  }

  getCatalogForPlatform(platform) {
    const modifiedCatalog = _.cloneDeep(this);
    _.remove(modifiedCatalog.services, function (service) {
      _.remove(service.plans, function (plan) {
        return !_.includes(_.get(plan, 'supported_platform', ['cf', 'sm']), platform);
      });
      return !_.includes(_.get(service, 'supported_platform', ['cf', 'sm']), platform);
    });
    return modifiedCatalog;
  }
}

module.exports = new Catalog();
