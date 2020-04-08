'use strict';

const _ = require('lodash');
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
  pushServicePlanToApiServer
};
