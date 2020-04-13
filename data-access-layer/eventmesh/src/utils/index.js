'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const config = require('@sf/app-config');
const decamelizeKeysDeep = require('decamelize-keys-deep');
const logger = require('@sf/logger');
const { catalog } = require('@sf/models');
const { apiServerClient } = require('../');
const { CONST } = require('@sf/common-utils');

function getAllServices() {
  return apiServerClient.getResources({
    resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
    resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES,
    allNamespaces: true
  })
    .then(serviceList => {
      let services = [];
      _.forEach(serviceList, service => {
        services = _.concat(services, [decamelizeKeysDeep(service.spec)]);
      });
      return services;
    });
}

function getAllPlansForService(serviceId) {
  return apiServerClient.getResources({
    resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
    resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS,
    query: {
      labelSelector: `serviceId=${serviceId}`
    },
    allNamespaces: true
  })
    .then(planList => {
      let plans = [];
      _.forEach(planList, plan => {
        plans = _.concat(plans, [plan.spec]);
      });
      return plans;
    });
}

function registerInterOperatorCrds() {
  return Promise.all([
    apiServerClient.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES),
    apiServerClient.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS),
    apiServerClient.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES),
    apiServerClient.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS),
    apiServerClient.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE, CONST.APISERVER.RESOURCE_TYPES.SFEVENT)
  ]);
}

function getServiceCrdFromConfig(service) {
  assert.ok(service.name, 'service.name is required to generate plan crd');
  assert.ok(service.id, 'service.id is required to generate plan crd');
  assert.ok(service.description, 'service.description is required to generate plan crd');
  assert.ok(service.bindable, 'service.bindable is required to generate plan crd');

  let serviceCRD = {
    apiVersion: 'osb.servicefabrik.io/v1alpha1',
    kind: 'SFService',
    metadata: {
      name: service.id,
      labels: {
        'controller-tools.k8s.io': '1.0',
        serviceId: service.id
      }
    },
    spec: {
      name: service.name,
      id: service.id,
      bindable: service.bindable,
      description: service.description,
      metadata: service.metadata,
      tags: service.tags,
      dashboardClient: service.dashboard_client,
      planUpdateable: service.plan_updateable
    }
  };
  return serviceCRD;
}



function getPlanCrdFromConfig(plan, service) {
  assert.ok(plan.name, 'plan.name is required to generate plan crd');
  assert.ok(plan.id, 'plan.id is required to generate plan crd');
  assert.ok(plan.description, 'plan.description is required to generate plan crd');

  let planCRD = {
    apiVersion: 'osb.servicefabrik.io/v1alpha1',
    kind: 'SFPlan',
    metadata: {
      name: plan.id,
      labels: {
        'controller-tools.k8s.io': '1.0',
        serviceId: service.id
      }
    },
    spec: {
      name: plan.name,
      id: plan.id,
      serviceId: service.id,
      description: plan.description,
      free: plan.free ? true : service.free ? true : false,
      bindable: plan.bindable ? plan.bindable : service.bindable ? service.bindable : false,
      planUpdatable: plan.bindable ? true : false,
      templates: plan.templates ? plan.templates : [],
      metadata: plan.metadata,
      manager: plan.manager,
      context: plan.context
    }
  };
  return planCRD;
}

function pushServicePlanToApiServer() {
  return Promise.map(_.get(config, 'services', []), service => {
    const servicePromise = apiServerClient.createOrUpdateServicePlan(getServiceCrdFromConfig(service));
    return Promise.map(service.plans, plan => apiServerClient.createOrUpdateServicePlan(getPlanCrdFromConfig(plan, service))
      .then(() => servicePromise));
  });
}
function loadCatalogFromAPIServer() {
  return getAllServices()
    .tap(services => {
      config.services = services;
    })
    .then(services => {
      return Promise.all(Promise.each(services, service => {
        return getAllPlansForService(service.id)
          .then(plans => {
            service.plans = plans;
          });
      }));
    })
    .then(() => catalog.reload())
    .tap(() => logger.silly('Loaded Services in catalog Are ', catalog.services))
    .tap(() => logger.silly('Loaded Plans in catalog Are ', catalog.plans));
}

module.exports = {
  loadCatalogFromAPIServer,
  registerInterOperatorCrds,
  pushServicePlanToApiServer,
  getServiceCrdFromConfig,
  getAllServices,
  getAllPlansForService
};
