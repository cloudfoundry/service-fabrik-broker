'use strict';

const _ = require('lodash');
const app = require('../support/apps').internal;
const { catalog } = require('@sf/models');
const config = require('@sf/app-config');
const { CONST } = require('@sf/common-utils');


describe('service-broker-api', function () {
  describe('catalog-cf', function () {
    const baseCFUrl = '/cf/v2';

    it('returns 200 Ok', function () {
      return chai.request(app)
        .get(`${baseCFUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .then(res => {
          expect(res).to.have.status(200);
          expect(res.body.services).to.be.instanceof(Array);
          expect(res.body.services).to.have.length(4);
          expect(res.body.services[0].plans).to.have.length(8);
          expect(res.body.services[1].plans).to.have.length(3);
        });
    });

    it('returns 200 Ok; Loads catalog from apiserver', function () {
      const oldServices = config.services;
      config.services = undefined;
      mocks.apiServerEventMesh.nockGetResourcesAcrossAllNamespaces(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, {
        items: [{
          spec: {
            id: 'service1',
            name: 's1'
          }
        }]
      },
        {});
      mocks.apiServerEventMesh.nockGetResourcesAcrossAllNamespaces(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS, {
        items: [{
          spec: {
            id: 'plan1',
            name: 'p1'
          }
        }]
      }, {
        labelSelector: 'serviceId=service1'
      },
        {});
      config.apiserver.isServiceDefinitionAvailableOnApiserver = true;
      return chai.request(app)
        .get(`${baseCFUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .then(res => {
          config.services = oldServices;
          catalog.reload();
          config.apiserver.isServiceDefinitionAvailableOnApiserver = false;
          expect(res).to.have.status(200);
          expect(res.body.services).to.be.instanceof(Array);
          expect(res.body.services).to.have.length(1);
          expect(res.body.services[0].plans).to.have.length(1);
        });
    });

    it('returns 405 Method not allowed', function () {
      return chai.request(app)
        .delete(`${baseCFUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .catch(err => err.response)
        .then(res => {
          expect(res).to.have.status(405);
          expect(res).to.have.header('allow', ['GET']);
        });
    });
  });

  describe('catalog-k8s', function () {
    const baseK8sUrl = '/k8s/v2';

    it('returns 200 Ok', function () {
      return chai.request(app)
        .get(`${baseK8sUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .then(res => {
          expect(res).to.have.status(200);
          expect(res.body.services).to.be.instanceof(Array);
          expect(res.body.services).to.have.length(1);
          expect(res.body.services[0].plans).to.have.length(4);
        });
    });

    it('returns 405 Method not allowed', function () {
      return chai.request(app)
        .delete(`${baseK8sUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .catch(err => err.response)
        .then(res => {
          expect(res).to.have.status(405);
          expect(res).to.have.header('allow', ['GET']);
        });
    });
  });

  describe('catalog-sm', function () {
    const baseSMUrl = '/sm/v2';
    it('should return entire catalog when supported_platform attribute not present', function () {
      let modifiedCatalog = _.cloneDeep(catalog);
      _.map(modifiedCatalog.services, function (service) {
        _.map(service.plans, function (plan) {
          _.unset(plan, 'supported_platform');
        });
        _.unset(service, 'supported_platform');
      });
      let toJsonStub = sinon.stub(catalog, 'toJSON');
      toJsonStub.returns({
        services: _.filter(modifiedCatalog.services, service => service.name.indexOf('-fabrik-internal') === -1)
      });
      return chai.request(app)
        .get(`${baseSMUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .then(res => {
          expect(res).to.have.status(200);
          expect(res.body.services).to.be.instanceof(Array);
          expect(res.body.services).to.have.length(4);
          expect(res.body.services[0].plans).to.have.length(8);
          expect(res.body.services[1].plans).to.have.length(3);
          toJsonStub.restore();
        });
    });
  });
});
