'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const app = require('../support/apps').internal;
const utils = require('../../../common/utils');
const config = require('../../../common/config');
const catalog = require('../../../common/models').catalog;
const ScheduleManager = require('../../../jobs');
const CONST = require('../../../common/constants');
const iaas = require('../../../data-access-layer/iaas');
const backupStore = iaas.backupStore;
const camelcaseKeys = require('camelcase-keys');

function enableServiceFabrikV2() {
  config.enable_service_fabrik_v2 = true;
}

function disableServiceFabrikV2() {
  config.enable_service_fabrik_v2 = false;
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
      const container = backupStore.containerName;
      const deferred = Promise.defer();
      Promise.onPossiblyUnhandledRejection(() => {});
      let getScheduleStub, delayStub;

      before(function () {
        enableServiceFabrikV2();
        backupStore.cloudProvider = new iaas.CloudProviderClient(config.backup.provider);
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
          testPayload.spec = camelcaseKeys(payload.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
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
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url).to.equal(dashboard_url);
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
          utilsStub = sinon.stub(utils, 'uuidV4').callsFake(() => Promise.resolve(workflowId));
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, testPayload);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              //context: context,
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
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
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
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
                'type': 'update'
              }));
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
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
                'type': 'update',
                serviceflow_name: 'upgrade_to_multi_az',
                serviceflow_id: workflowId
              }));
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
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
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
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
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
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
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
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
              operation: utils.encodeBase64({
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

        it('delete-sf20: returns 410 GONE', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, 404);
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: utils.encodeBase64({
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
              response: utils.encodeBase64(mocks.agent.credentials)
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
        it('returns 201 Created', function (done) {
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
              response: utils.encodeBase64(mocks.agent.credentials)
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
              response: utils.encodeBase64(mocks.agent.credentials)
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

        it.only('Throws error if bind times out', function (done) {
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
          const timeout = CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS;
          CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS = 0;
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
              CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS = timeout;
              expect(res).to.have.status(500);
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