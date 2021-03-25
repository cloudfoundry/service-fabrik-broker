'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const app = require('../../../../test/test_broker/support/apps').internal;
const config = require('@sf/app-config');
const { catalog } = require('@sf/models');
const ScheduleManager = require('@sf/jobs');
const {
  CONST,
  commonFunctions
} = require('@sf/common-utils');
const {
  CloudProviderClient,
  backupStore
} = require('@sf/iaas');
const camelcaseKeys = require('camelcase-keys');

function enableServiceFabrikV2() {
  config.enable_service_fabrik_v2 = true;
}

function disableServiceFabrikV2() {
  config.enable_service_fabrik_v2 = false;
}

function enableConcurrentOps() {
  config.allowConcurrentOperations = true;
  config.allowConcurrentBindingOperations = true;
}

function disableConcurrentOps() {
  config.allowConcurrentOperations = false;
  config.allowConcurrentBindingOperations = false;
}

describe('service-broker-api-2.0', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/cf/v2';
      const sm_base_url = '/sm/v2';
      const index = mocks.director.networkSegmentIndex;
      const api_version = '2.12';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan_id_custom_dashboard = 'bc158c9a-7934-401e-94ab-057082a5073e';
      const plan = catalog.getPlan(plan_id);
      const plan_id_deprecated = 'b91d9512-b5c9-4c4a-922a-fa54ae67d235';
      const plan_id_update = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = mocks.director.uuidByIndex(index);
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const parameters = {
        foo: 'bar'
      };
      const subaccount_id = 'b319968c-0eba-43f2-959b-40f507c269fd';
      const clusterid = '182731cd-d50b-4106-bde3-8cf410ec5940';
      const namespace = 'default-namespace';
      const accepts_incomplete = true;
      const protocol = config.external.protocol;
      const host = config.external.host;
      const dashboard_url = `${protocol}://${host}/manage/dashboards/director/instances/${instance_id}`;
      const dashboard_url_with_template = `${protocol}://${host}/manage/dashboards/director/instances/${instance_id}?planId=${plan_id}&serviceId=${service_id}`;
      const container = backupStore.containerName;
      const deferred = Promise.defer();
      Promise.onPossiblyUnhandledRejection(() => {});
      let getScheduleStub, delayStub;

      before(function () {
        enableServiceFabrikV2();
        enableConcurrentOps();
        backupStore.cloudProvider = new CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule');
        getScheduleStub.withArgs().returns(deferred.promise);
        plan.service.subnet = null;
        delayStub = sinon.stub(Promise, 'delay').callsFake(() => Promise.resolve(true));
        return mocks.setup([
          backupStore.cloudProvider.getContainer()
        ]);
      });

      afterEach(function () {
        mocks.reset();
        getScheduleStub.resetHistory();
        enableConcurrentOps();
      });

      after(function () {
        disableServiceFabrikV2();
        getScheduleStub.restore();
        delayStub.restore();
      });

      describe('#provision', function () {
        let payload = {
          apiVersion: 'osb.servicefabrik.io/v1alpha1',
          kind: 'SFServiceInstance',
          metadata: {
            name: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
            context: {
              platform: 'cloudfoundry',
              organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
              space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
            },
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
            parameters: {
              foo: 'bar'
            }

          },
          status: {
            state: 'in_queue'
          }
        };

        it('returns 202 Accepted', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec.plan_id = plan_id_custom_dashboard;
          testPayload.spec = camelcaseKeys(testPayload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            metadata:{
              name:  instance_id
            },
            spec: {
              clusterId: 1,
              planId: plan_id_custom_dashboard,
              serviceId: service_id,
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id_custom_dashboard,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url === dashboard_url_with_template);
              mocks.verify();
            });
        });

        it('returns 202 Accepted -- fetching correct values for labels from context', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec.plan_id = plan_id_custom_dashboard;
          const testContext = {
            platform: 'sapcp',
            organization_guid: organization_guid,
            space_guid: space_guid,
            organization_name: 'test',
            space_name: 'service-fabrik',
            instance_name: 'bp-monitor',
            landscape_label: 'cf-eu10-canary',
            origin: 'cloudfoundry',
            zone_id: 'service-fabrik',
            global_account_id: '9808a7d5-5c36-4149-b62d-1095373bdfaa',
            license_type: 'LSS script',
            subaccount_id: 'service-fabrik',
            subdomain: 'service-fabrik'
          };
          testPayload.spec.context = testContext;
          testPayload.spec = camelcaseKeys(testPayload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            metadata:{
              name:  instance_id
            },
            spec: {
              clusterId: 1,
              planId: plan_id_custom_dashboard,
              serviceId: service_id,
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id_custom_dashboard,
              context: testContext,
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url === dashboard_url_with_template);
              mocks.verify();
            });
        });

        it('returns 202 Accepted -- fetching correct region value in labels', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec.plan_id = plan_id_custom_dashboard;
          const testContext = {
            platform: 'sapcp',
            organization_guid: organization_guid,
            space_guid: space_guid,
            organization_name: 'test',
            space_name: 'service-fabrik',
            instance_name: 'bp-monitor',
            landscape_label: 'cf-eu10-canary',
            origin: 'cloudfoundry',
            zone_id: 'service-fabrik',
            global_account_id: '9808a7d5-5c36-4149-b62d-1095373bdfaa',
            license_type: 'LSS script',
            subaccount_id: 'service-fabrik',
            subdomain: 'service-fabrik'
          };
          testPayload.spec.context = testContext;
          testPayload.metadata.labels.region = 'eu10';
          testPayload.spec = camelcaseKeys(testPayload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            metadata:{
              name:  instance_id
            },
            spec: {
              clusterId: 1,
              planId: plan_id_custom_dashboard,
              serviceId: service_id,
            }
          });
          return chai.request(app)
            .put(`/cf/region/eu10/v2/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id_custom_dashboard,
              context: testContext,
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url === dashboard_url_with_template);
              mocks.verify();
            });
        });
        
        it('returns UnprocessableEntity entity when dashboard template url does not evaluate to a valid URL', function () {
          const oldTemp = config.services[0].plans[4].manager.settings.dashboard_url_template;
          config.services[0].plans[4].manager.settings.dashboard_url_template = new Buffer('${instance.spec.clusterId == 1 ? \'blah://service-fabrik-broker.bosh-lite.com/manage/dashboards/director/instances/\'+instance.metadata.name+\'?planId=\'+instance.spec.planId+\'&serviceId=\'+instance.spec.serviceId : \'\'}').toString('base64');
          const testPayload = _.cloneDeep(payload);
          testPayload.spec.plan_id = plan_id_custom_dashboard;
          testPayload.spec = camelcaseKeys(testPayload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            metadata:{
              name:  instance_id
            },
            spec: {
              clusterId: 1,
              planId: plan_id_custom_dashboard,
              serviceId: service_id,
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id_custom_dashboard,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .catch(err => err.response)
            .then(res => {
              config.services[0].plans[4].manager.settings.dashboard_url_template = oldTemp;
              expect(res).to.have.status(CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it('returns 202 Accepted -- for requests via SM originating from CF', function () {
          let oldOptions = payload.spec;
          let newOptions = {
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
            context: {
              platform: 'sapcp',
              origin: 'cloudfoundry',
              organization_guid: organization_guid,
              space_guid: space_guid,
              subaccount_id: subaccount_id
            },
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
            parameters: {
              foo: 'bar'
            }
          };
          payload.spec = newOptions;
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          return chai.request(app)
            .put(`${sm_base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'sapcp',
                origin: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid,
                subaccount_id: subaccount_id
              },
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .then(res => {
              payload.spec = oldOptions;
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url).to.equal(dashboard_url);
              mocks.verify();
            });
        });

        it('returns 202 Accepted -- for requests via SM originating from k8s', function () {
          let oldOptions = payload.spec;
          let newOptions = {
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
            context: {
              platform: 'sapcp',
              origin: 'kubernetes',
              namespace: namespace,
              subaccount_id: subaccount_id,
              clusterid: clusterid
            },
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
            parameters: {
              foo: 'bar'
            }
          };
          payload.spec = newOptions;
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          return chai.request(app)
            .put(`${sm_base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'sapcp',
                origin: 'kubernetes',
                namespace: namespace,
                subaccount_id: subaccount_id,
                clusterid: clusterid
              },
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .then(res => {
              payload.spec = oldOptions;
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url).to.equal(dashboard_url);
              mocks.verify();
            });
        });

        it('returns 409 failed if resource already exists', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload, 409);
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(409);
              expect(res.body).to.deep.equal({});
              mocks.verify();
            });
        });

        it('does unlock when an error happens', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'create'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(404);
              mocks.verify();
            });
        });


        it('returns 403 for deprecated plan', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id_deprecated,
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              }
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete not passed in query', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              parameters: parameters
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete undefined', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete not true', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=false`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 400 BadRequest when space_guid missing', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              organization_guid: organization_guid,
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body.error).to.be.eql('Bad Request');
              expect(res.body.description).to.be.eql('This request is missing mandatory organization guid and/or space guid.');
            });
        });

        it('returns 400 BadRequest when organization_guid missing', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              space_guid: space_guid,
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body.error).to.be.eql('Bad Request');
              expect(res.body.description).to.be.eql('This request is missing mandatory organization guid and/or space guid.');
            });
        });
      });


      describe('#update', function () {
        const payload = {
          metadata: {
            labels: {
              state: 'update'
            }
          },
          spec: {
            service_id: service_id,
            plan_id: plan_id_update,
            parameters: {
              foo: 'bar'
            },
            context: {
              platform: 'cloudfoundry',
              organization_guid: organization_guid,
              space_guid: space_guid
            },
            previous_values: {
              plan_id: plan_id,
              service_id: service_id
            }
          },
          status: {
            state: 'update'
          }
        };
        const workflowId = 'w651abb8-0921-4c2e-9565-a19776d95619';
        const workflow_payload = {
          apiVersion: 'serviceflow.servicefabrik.io/v1alpha1',
          kind: 'SerialServiceFlow',
          metadata: {
            name: workflowId,
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            options: JSON.stringify({
              serviceflow_name: 'upgrade_to_multi_az',
              instance_id: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
              operation_params: {
                service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
                plan_id: 'd616b00a-5949-4b1c-bc73-0d3c59f3954a',
                parameters: {
                  multi_az: true
                },
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
                  space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
                },
                previous_values: {
                  plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
                  service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
                }
              },
              user: {
                name: 'broker'
              }
            })
          },
          status: {
            state: 'in_queue',
            response: '{}'
          }
        };
        let utilsStub;

        before(function () {
          utilsStub = sinon.stub(commonFunctions, 'uuidV4').callsFake(() => Promise.resolve(workflowId));
        });
        after(function () {
          utilsStub.restore();
        });

        it('no context : returns 202 Accepted', function () {
          const payload1 = {
            metadata: {
              labels: {
                state: 'update'
              }
            },
            spec: {
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: {
                foo: 'bar'
              },
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            },
            status: {
              state: 'update'
            }
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'update'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          const testPayload = _.cloneDeep(payload1);
          testPayload.spec = camelcaseKeys(payload1.spec);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, { spec: { parameters: null } });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, testPayload);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              // context: context,
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'update'
              }));
              mocks.verify();
            });
        });

        it('returns 202 Accepted if resource is already present', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'update'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, { spec: { parameters: null } });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, testPayload);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              context: context,
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .then(res => {
              mocks.verify();
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'update'
              }));
            });
        });

        it('returns 202 Accepted if resource is already present- fetching correct region too', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'update'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);
          testPayload.metadata.labels.region = 'eu10';
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, { spec: { parameters: null } });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, testPayload);
          return chai.request(app)
            .patch(`/cf/region/eu10/v2/service_instances/${instance_id}?accepts_incomplete=true`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              context: context,
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .then(res => {
              mocks.verify();
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'update'
              }));
            });
        });

        it('returns 202 Accepted if resource is already present and plan_id is not present in the request', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'update'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            spec: {
              planId: plan_id_update
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, { spec: { parameters: null } });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, testPayload);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .send({
              service_id: service_id,
              parameters: parameters,
              context: context,
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .then(res => {
              mocks.verify();
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'update'
              }));
            });
        });

        it('returns ServicePlanNotFound error if resource could not be fetched and plan_id is not present in the request', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1 , 500);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .send({
              service_id: service_id,
              parameters: parameters,
              context: context,
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              mocks.verify();
              expect(res).to.have.status(404);
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete not in query', function () {
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete is undefined', function () {
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete is not true', function () {
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=false`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 202 Accepted for initiating a workflow', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'update'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW, CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW, {}, 1, workflow_payload);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: {
                multi_az: true
              },
              context: context,
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .then(res => {
              mocks.verify();
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'update',
                serviceflow_name: 'upgrade_to_multi_az',
                serviceflow_id: workflowId
              }));
            });
        });

        it('returns 422 concurrency error for concurrent operations when allowConcurrentOperations config is not set', function() {
          disableConcurrentOps();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              state: 'in_progress'
            }
          });
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => {
              return err.response;
            })
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('ConcurrencyError');
              expect(res.body.description).to.be.eql('Another operation for this Service Instance is in progress.');
              mocks.verify();
            });
        });

        it('returns 422 concurrency error for concurrent binding operations when allowConcurrentBindingOperations config is not set', function() {
          disableConcurrentOps();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              state: 'succeeded'
            }
          });
          mocks.apiServerEventMesh.nockGetResources(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {
            items: [{
              status: {
                state: 'in_progress'
              }
            }]
          },{
            labelSelector: `instance_guid=${instance_id}`
          },
            {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => {
              return err.response;
            })
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('ConcurrencyError');
              expect(res.body.description).to.be.eql('Another operation for this Service Instance is in progress.');
              mocks.verify();
            });
        });

        it('returns 202 accepted when allowConcurrentBindingOperations/allowConcurrentOperations config is not set and concurrent operations are not ongoing ', function() {
          disableConcurrentOps();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              state: 'succeeded'
            }
          });
          mocks.apiServerEventMesh.nockGetResources(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {
            items: [{
              status: {
                state: 'succeeded'
              }
            }]
          },{
            labelSelector: `instance_guid=${instance_id}`
          },
            {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'update'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => {
              return err.response;
            })
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'delete'
              }));
              mocks.verify();
            });
        });
      });



      describe('#deprovision', function () {
        it('returns 202 Accepted if resource exists', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'update'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'delete'
              }));
              mocks.verify();
            });
        });

        it('returns 410 GONE if resource does not exist', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'delete'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(410);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it('returns 202 Accepted : existing deployments having no platform-context', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'delete'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'delete'
              }));
              mocks.verify();
            });
        });
        it('returns 202 Accepted : In K8S Platform', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'delete'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(commonFunctions.encodeBase64({
                'type': 'delete'
              }));
              mocks.verify();
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete is not in query', function () {
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete is undefined', function () {
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: undefined
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete is not true', function () {
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: false
            })
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

      });



      describe('#lastOperation', function () {
        it('create-sf20: returns 200 OK (state = in progress)', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Create deployment ${deployment_name} is still in progress`,
              state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Create deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });
        it('create-sf20: returns 200 OK (state = succeeded)', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
              state: 'succeeded'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });
        it('create-sf20: returns 200 OK (state = in progress): In K8S platform', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Create deployment ${deployment_name} is still in progress`,
              state: 'in progress'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Create deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });
        it('create-sf20: returns 200 OK (state = succeeded): In K8S platform', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
              state: 'succeeded'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });
        it('update-sf20: returns 200 OK (state = in progress)', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Update deployment ${deployment_name} is still in progress`,
              state: 'in progress'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Update deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });
        it('update-sf20: returns 200 OK (state = succeeded)', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Update deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
              state: 'succeeded'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Update deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });

        it('update-sf20: returns 200 OK (state = failed) contains instance_usable and update_repeatable if provided', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Update deployment ${deployment_name} failed at 2016-07-04T10:58:24.000Z`,
              state: 'failed',
              instanceUsable: 'false',
              updateRepeatable: 'true'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: commonFunctions.encodeBase64({
                'type': 'update'
              })
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Update deployment ${deployment_name} failed at 2016-07-04T10:58:24.000Z`,
                state: 'failed',
                instance_usable: false,
                update_repeatable: true
              });
              mocks.verify();
            });
        });
        it('update-sf20: returns 200 OK (state = in progress): In K8S platform', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Update deployment ${deployment_name} is still in progress`,
              state: 'in progress'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Update deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });
        it('update-sf20: returns 200 OK (state = succeeded): In K8S platform', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Update deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
              state: 'succeeded'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Update deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });
        
        it('delete-sf20: returns 200 OK (state = in progress)', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Delete deployment ${deployment_name} is still in progress`,
              state: 'in progress'
            }
          });
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Delete deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });
        it('delete-sf20: returns 200 OK (state = succeeded)', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Delete deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
              state: 'succeeded'
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            metadata: {
              resourceVersion: 10,
              finalizers: ['broker.servicefabrik.io']
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1);

          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: commonFunctions.encodeBase64({
                'type': 'delete'
              })
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Delete deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });
        it('delete-sf20: returns 200 OK (state = failed) contains instance_usable if provided', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {
            status: {
              description: `Delete deployment ${deployment_name} failed at 2016-07-04T10:58:24.000Z`,
              state: 'failed',
              instanceUsable: 'true'
            }
          });
          
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: commonFunctions.encodeBase64({
                'type': 'delete'
              })
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Delete deployment ${deployment_name} failed at 2016-07-04T10:58:24.000Z`,
                state: 'failed',
                instance_usable: true
              });
              mocks.verify();
            });
        });
        it('delete-sf20: returns 410 GONE', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, 404);
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: commonFunctions.encodeBase64({
                'type': 'delete'
              })
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(410);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

      });

      describe('#bind', function () {
        it('no context : returns 201 Created', function (done) {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'succeeded',
              response: {
                secretRef: 'secret-name'
              }
            }
          });
          mocks.apiServerEventMesh.nockGetSecret('secret-name', 'default', {
            data: {
              response: commonFunctions.encodeBase64({ credentials: mocks.agent.credentials })
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              app_guid: app_guid,
              bind_resource: {
                app_guid: app_guid
              }
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                credentials: mocks.agent.credentials
              });
              mocks.verify();
              done();
            });
        });
        it('returns 201 Created - returns additional fields from secret', function (done) {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'succeeded',
              response: {
                secretRef: 'secret-name'
              }
            }
          });
          mocks.apiServerEventMesh.nockGetSecret('secret-name', 'default', {
            data: {
              response: commonFunctions.encodeBase64({ 
                "credentials": mocks.agent.credentials,
                "metadata": {
                  "expires_at": "2022-03-24T17:18:20Z",
                  "renew_before": "2021-12-23T11:18:20Z"
                } 
              })
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              app_guid: app_guid,
              bind_resource: {
                app_guid: app_guid
              },
              context: context
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                credentials: mocks.agent.credentials,
                "metadata": {
                  "expires_at": "2022-03-24T17:18:20Z",
                  "renew_before": "2021-12-23T11:18:20Z"
                } 
              });
              mocks.verify();
              done();
            });
        });

        it('returns 201 Created - metadata omitted if sendBindingMetadata config is off', function (done) {
          config.sendBindingMetadata = false;
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'succeeded',
              response: {
                secretRef: 'secret-name'
              }
            }
          });
          mocks.apiServerEventMesh.nockGetSecret('secret-name', 'default', {
            data: {
              response: commonFunctions.encodeBase64({ 
                "credentials": mocks.agent.credentials,
                "metadata": {
                  "expires_at": "2022-03-24T17:18:20Z",
                  "renew_before": "2021-12-23T11:18:20Z"
                } 
              })
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              app_guid: app_guid,
              bind_resource: {
                app_guid: app_guid
              },
              context: context
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                credentials: mocks.agent.credentials
              });
              mocks.verify();
              _.unset(config, 'sendBindingMetadata')
              done();
            });
        });

        it('returns 201 Created: In K8S platform', function (done) {
          const context = {
            platform: 'kubernetes',
            namespace: 'default'
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'succeeded',
              response: {
                secretRef: 'secret-name'
              }
            }
          });
          mocks.apiServerEventMesh.nockGetSecret('secret-name', 'default', {
            data: {
              response: commonFunctions.encodeBase64({ credentials: mocks.agent.credentials })
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              app_guid: app_guid,
              bind_resource: {
                app_guid: app_guid
              },
              context: context
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                credentials: mocks.agent.credentials
              });
              mocks.verify();
              done();
            });
        });

        it('Throws error if bind fails', function (done) {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'failed',
              error: {
                code: 500,
                message: 'This is sparta'
              }
            }
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              app_guid: app_guid,
              bind_resource: {
                app_guid: app_guid
              }
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(500);
              mocks.verify();
              done();
            });
        });

        it('Throws error if bind times out', function (done) {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'in progress'
            }
          });
          const timeout = CONST.OSB_OPERATION.OSB_SYNC_OPERATION_TIMEOUT_IN_SEC;
          CONST.OSB_OPERATION.OSB_SYNC_OPERATION_TIMEOUT_IN_SEC = 0;
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              app_guid: app_guid,
              bind_resource: {
                app_guid: app_guid
              }
            })
            .catch(err => err.response)
            .then(res => {
              CONST.OSB_OPERATION.OSB_SYNC_OPERATION_TIMEOUT_IN_SEC = timeout;
              expect(res).to.have.status(429);
              mocks.verify();
              done();
            });
        });

      });



      describe('#unbind', function () {
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {}, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'succeeded',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
        it('returns 200 OK : for existing deployment having no platform-context', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {}, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'succeeded',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
        it('returns 200 OK: In K8S platform', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {}, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {
            status: {
              state: 'succeeded',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, {});
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });

    });
  });
});
