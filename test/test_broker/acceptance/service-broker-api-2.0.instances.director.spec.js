'use strict';

const _ = require('lodash');
const lib = require('../../../broker/lib');
//const errors = require('../../../common/errors');
const Promise = require('bluebird');
const app = require('../support/apps').internal;
const utils = require('../../../common/utils');
const config = require('../../../common/config');
const catalog = require('../../../common/models').catalog;
const fabrik = lib.fabrik;
const ScheduleManager = require('../../../jobs');
const CONST = require('../../../common/constants');
const DirectorManager = lib.fabrik.DirectorManager;
const cloudController = require('../../../data-access-layer/cf').cloudController;
const iaas = require('../../../data-access-layer/iaas');
const backupStore = iaas.backupStore;

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
      const index = mocks.director.networkSegmentIndex;
      const api_version = '2.12';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const service_plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';
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
      const deploymentHookRequestBody = {
        phase: 'PreCreate',
        actions: ['Blueprint', 'ReserveIps'],
        context: {
          params: {
            context: {
              platform: 'cloudfoundry',
              organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
              space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
            },
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
            parameters: {
              'foo': 'bar'
            },
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f'
          },
          deployment_name: 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
          sf_operations_args: {},
          instance_guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa'
        }
      };
      const accepts_incomplete = true;
      const protocol = config.external.protocol;
      const host = config.external.host;
      const dashboard_url = `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id}`;
      const container = backupStore.containerName;
      const deferred = Promise.defer();
      Promise.onPossiblyUnhandledRejection(() => {});
      let getScheduleStub;

      before(function () {
        enableServiceFabrikV2();
        backupStore.cloudProvider = new iaas.CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        _.unset(fabrik.DirectorManager, plan_id);
        getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule');
        getScheduleStub.withArgs().returns(deferred.promise);
        plan.service.subnet = null;
        return mocks.setup([
          fabrik.DirectorManager.load(plan),
          backupStore.cloudProvider.getContainer()
        ]);
      });

      afterEach(function () {
        mocks.reset();
        getScheduleStub.reset();
      });

      after(function () {
        disableServiceFabrikV2();
        getScheduleStub.restore();
      });

      describe('#provision', function () {
        const payload = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'Director',
          metadata: {
            name: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            options: JSON.stringify({
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
            })
          },
          status: {
            state: 'in_queue',
            lastOperation: '{}',
            response: '{}'
          }
        };
        it('returns 202 Accepted', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, {}, 1, payload);
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

        it('returns 409 failed if resource already exists', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, {}, 1, payload, 409);
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
            options: JSON.stringify({
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
            })
          },
          status: {
            state: 'update',
            lastOperation: '{}',
            response: '{}'
          }
        };
        it('no context : returns 202 Accepted', function () {
          const payload1 = {
            metadata: {
              labels: {
                state: 'update'
              }
            },
            spec: {
              options: JSON.stringify({
                service_id: service_id,
                plan_id: plan_id_update,
                parameters: {
                  foo: 'bar'
                },
                previous_values: {
                  plan_id: plan_id,
                  service_id: service_id
                }
              })
            },
            status: {
              state: 'update',
              lastOperation: '{}',
              response: '{}'
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, payload1);
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, payload);
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
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
                'type': 'update'
              }));
              mocks.verify();
            });
        });

        it('returns 202 Accepted if resource is not present', function () {
          const payloadUpdate = _.cloneDeep(payload);
          payloadUpdate.apiVersion = 'deployment.servicefabrik.io/v1alpha1';
          payloadUpdate.kind = 'Director';
          //let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          _.set(expectedRequestBody.context.params, 'plan_id', plan_id_update);
          _.set(expectedRequestBody.context.params, 'previous_values', {
            plan_id: plan_id,
            service_id: service_id
          });
          expectedRequestBody.context.params = _.chain(expectedRequestBody.context.params)
            .omit('space_guid')
            .omit('organization_guid')
            .value();
          expectedRequestBody.context.params.previous_manifest = mocks.director.manifest;
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
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
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, {}, 1, payloadUpdate);
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
              expect(res).to.have.status(202);
              expect(res.body.operation).to.deep.equal(utils.encodeBase64({
                'type': 'update'
              }));
              mocks.verify();
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
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

        it('returns 202 Accepted if resource does not exist', function () {
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
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, {});
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Create deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Create deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Update deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Update deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Update deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Update deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Delete deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              })
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            status: {
              lastOperation: JSON.stringify({
                description: `Delete deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              })
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
                description: `Delete deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });

        it('delete-sf20: returns 410 GONE', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, 404);
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
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {
            status: {
              state: 'succeeded',
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
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {
            status: {
              state: 'succeeded',
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
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {
            status: {
              state: 'succeeded',
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

      });



      describe('#unbind', function () {
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {
            status: {
              state: 'succeeded',
              response: '{}'
            }
          });
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {});
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

        it('returns 200 OK if resource does not exist', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {
            status: {
              state: 'succeeded',
              response: '{}'
            }
          });
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {});
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {
            status: {
              state: 'succeeded',
              response: '{}'
            }
          });
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {});
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {
            status: {
              state: 'succeeded',
              response: '{}'
            }
          });
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, binding_id, {});
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

      describe('#getInfo', function () {
        let sandbox, getDeploymentInfoStub, getServiceInstanceStub, getServicePlanStub;
        before(function () {
          sandbox = sinon.sandbox.create();
          getDeploymentInfoStub = sandbox.stub(DirectorManager.prototype, 'getDeploymentInfo');
          getServiceInstanceStub = sandbox.stub(cloudController, 'getServiceInstance');
          getServicePlanStub = sandbox.stub(cloudController, 'getServicePlan');

          let entity = {};
          getServiceInstanceStub
            .withArgs(instance_id)
            .returns(Promise.try(() => {
              return {
                metadata: {
                  guid: instance_id
                },
                entity: _.assign({
                  name: 'blueprint',
                  service_plan_guid: '466c5078-df6e-427d-8fb2-c76af50c0f56'
                }, entity)
              };
            }));

          getDeploymentInfoStub
            .withArgs(deployment_name)
            .returns(Promise.try(() => {
              return {};
            }));

          entity = {};
          getServicePlanStub
            .withArgs(service_plan_guid, {})
            .returns(Promise.try(() => {
              return {
                entity: _.assign({
                  unique_id: plan_id,
                  name: 'blueprint'
                }, entity)
              };
            }));

        });

        after(function () {
          sandbox.restore();
        });

        it('should return object with correct plan and service information', function () {
          let context = {
            platform: 'cloudfoundry'
          };
          return fabrik
            .createInstance(instance_id, service_id, plan_id, context)
            .then(instance => instance.getInfo())
            .catch(err => err.response)
            .then(res => {
              expect(res.title).to.equal('Blueprint Dashboard');
              expect(res.plan.id).to.equal(plan_id);
              expect(res.service.id).to.equal(service_id);
              expect(res.instance.metadata.guid).to.equal(instance_id);
            });
        });
      });
    });
  });
});