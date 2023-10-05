'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const app = require('../../../../test/test_broker/support/apps').internal;
const { catalog } = require('@sf/models');
const config = require('@sf/app-config');
const {
  CONST,
  commonFunctions: {
    encodeBase64
  }
} = require('@sf/common-utils');
const camelcaseKeys = require('camelcase-keys');

describe('service-broker-api-2.0', function () {
  describe('instances', function () {
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const instance_id = '951f7a03-df8a-4b75-90be-38abe455568d';
    const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
    const baseCFUrl = '/cf/v2';

    afterEach(function () {
      mocks.reset();
    });
    
    describe('#fetch-instance', function () {
      const payload2 = {
        apiVersion: 'osb.servicefabrik.io/v1alpha1',
        kind: 'SFServiceInstance',
        metadata: {
          finalizers: ['broker.servicefabrik.io'],
          name: instance_id,
          labels: {
            'interoperator.servicefabrik.io/lastoperation': 'in_queue',
            state: 'in_queue'
          }
        },
        spec: {
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          },
          organization_guid: organization_guid,
          space_guid: space_guid,
          parameters: {
            foo: 'bar'
          }
        },
        status: {
          state: 'succeeded'
        }
      };

      it('returns 400 (BadRequest) error if service does not support instance retrieval', function () {
        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
            mocks.verify();
          });
      });

      it('returns 404 if service instance not found', function () {
        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, 404);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(404);
            mocks.verify();
          });
      });

      it('returns 404 if status is in_queue', function () {
        const oldServices = config.services;
        const service = _.find(config.services, ['id', service_id]);
        if (service) {
          _.set(service, 'instances_retrievable', true);
          catalog.reload();
        }

        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.status.state = 'in_queue';
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            config.services = oldServices;
            catalog.reload();
            expect(res).to.have.status(404);
            mocks.verify();
          });
      });

      it('returns 422 if status is delete', function () {
        const oldServices = config.services;
        const service = _.find(config.services, ['id', service_id]);
        if (service) {
          _.set(service, 'instances_retrievable', true);
          catalog.reload();
        }

        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.status.state = 'delete';
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            config.services = oldServices;
            catalog.reload();
            expect(res).to.have.status(422);
            expect(res.body.error).to.deep.equal('ConcurrencyError');
            expect(res.body.description).to.deep.equal('Service Instance is being deleted and therefore cannot be fetched at this time');
            mocks.verify();
          });
      });

      it('returns 404 if status is create in progress', function () {
        const oldServices = config.services;
        const service = _.find(config.services, ['id', service_id]);
        if (service) {
          _.set(service, 'instances_retrievable', true);
          catalog.reload();
        }

        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.status.state = 'in progress';
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            config.services = oldServices;
            catalog.reload();
            expect(res).to.have.status(404);
            mocks.verify();
          });
      });

      it('returns 422 if status is update in progress', function () {
        const oldServices = config.services;
        const service = _.find(config.services, ['id', service_id]);
        if (service) {
          _.set(service, 'instances_retrievable', true);
          catalog.reload();
        }

        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.status.state = 'in progress';
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        testPayload2.metadata.labels['interoperator.servicefabrik.io/lastoperation'] = 'update'
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            config.services = oldServices;
            catalog.reload();
            expect(res).to.have.status(422);
            expect(res.body.error).to.be.eql('ConcurrencyError');
            expect(res.body.description).to.be.eql('Service Instance updation is in progress and therefore cannot be fetched at this time');
            mocks.verify();
          });
      });

      it('returns 422 if status is update', function () {
        const oldServices = config.services;
        const service = _.find(config.services, ['id', service_id]);
        if (service) {
          _.set(service, 'instances_retrievable', true);
          catalog.reload();
        }

        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.status.state = 'update';
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            config.services = oldServices;
            catalog.reload();
            expect(res).to.have.status(422);
            expect(res.body.error).to.deep.equal('ConcurrencyError');
            expect(res.body.description).to.deep.equal('Service Instance is being updated and therefore cannot be fetched at this time');
            mocks.verify();
          });
      });

      it('returns 412 (PreconditionFailed) error if broker api version is not atleast 2.14', function () {
        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.12')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(412);
          });
      });
      
      it('should return X-Broker-API-Request-Identity in response if set in request (with precondition failure)', function () {
        const testPayload2 = _.cloneDeep(payload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}`)
          .set('X-Broker-API-Version', '2.12')
          .set('X-Broker-API-Request-Identity', 'someid')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(412);
            expect(res).to.have.header('X-Broker-API-Request-Identity', 'someid');
          });
      });

    });


    describe('#fetch-binding', function () {
      const bindPayload2 = {
        apiVersion: 'osb.servicefabrik.io/v1alpha1',
        kind: 'SFServiceBinding',
        metadata: {
          finalizers: ['broker.servicefabrik.io'],
          name: binding_id,
          labels: {
            state: 'succeeded'
          }
        },
        spec: {
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          },
          organization_guid: organization_guid,
          space_guid: space_guid,
          parameters: {
            foo: 'bar'
          }
        },
        status: {
          state: 'succeeded',
          response: {
            secretRef: binding_id
          }
        }
      };

      it('returns 400 (BadRequest) error if service does not support binding retrieval', function () {
        const testPayload2 = _.cloneDeep(bindPayload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}/service_bindings/${binding_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
            mocks.verify();
          });
      });

      it('returns 400 (BadRequest) error if service plan is not bindable', function () {
        const oldServices = config.services;
        const service = _.find(config.services, ['id', service_id]);
        const plan = _.find(service.plans, ['id', plan_id]);
        if (service) {
          _.set(service, 'bindings_retrievable', true);
          _.set(service, 'bindable', true);
        }
        if (plan) {
          _.set(plan, 'bindable', false);
        }
        catalog.reload();

        const testPayload2 = _.cloneDeep(bindPayload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}/service_bindings/${binding_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            config.services = oldServices;
            catalog.reload();
            expect(res).to.have.status(400);
            mocks.verify();
          });
      });

      it('returns 404 if binding not found', function () {
        const testPayload2 = _.cloneDeep(bindPayload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {}, 1, 404);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}/service_bindings/${binding_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(404);
            mocks.verify();
          });
      });

      it('returns 404 if service binding status is not succeeded', function () {
        const oldServices = config.services;
        const service = _.find(config.services, ['id', service_id]);
        if (service) {
          _.set(service, 'bindings_retrievable', true);
          _.set(service, 'bindable', true);
        }
        catalog.reload();

        const testPayload2 = _.cloneDeep(bindPayload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        testPayload2.status.state = 'failed';
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}/service_bindings/${binding_id}`)
          .set('X-Broker-API-Version', '2.14')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            config.services = oldServices;
            catalog.reload();
            expect(res).to.have.status(404);
            mocks.verify();
          });
      });

      it('returns 412 (PreconditionFailed) error if broker api version is not atleast 2.14', function () {
        const testPayload2 = _.cloneDeep(bindPayload2);
        testPayload2.spec = camelcaseKeys(testPayload2.spec);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, testPayload2, 1);
        return chai.request(app)
          .get(`${baseCFUrl}/service_instances/${instance_id}/service_bindings/${binding_id}`)
          .set('X-Broker-API-Version', '2.12')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(412);
          });
      });

    });
  });
});
