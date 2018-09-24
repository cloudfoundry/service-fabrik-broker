'use strict';

const app = require('../support/apps').internal;
const config = require('../../../common/config');
const errors = require('../../../common/errors');
const CONST = require('../../../common/constants');
const utils = require('../../../common/utils');
const NotFound = errors.NotFound;

describe('service-broker-api', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('virtualHost', function () {
      const base_url = '/cf/v2';
      const api_version = '2.12';
      const service_id = '19f17a7a-5247-4ee2-94b5-03eac6756388';
      const plan_id = 'd035f948-5d3a-43d7-9aec-954e134c3e9d';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = 'b3e03cb5-29cc-4fcf-9900-023cf149c554';
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const instance_name = 'rmq';
      const parameters = {
        dedicated_rabbitmq_instance: `${instance_name}`
      };
      const accepts_incomplete = true;
      const protocol = config.external.protocol;
      const host = config.external.host;
      const dashboard_url = `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id}`;
      const context = {
        platform: 'cloudfoundry',
        organization_guid: organization_guid,
        space_guid: space_guid
      };

      afterEach(function () {
        mocks.reset();
      });

      let sandbox, delayStub;
      before(function () {
        sandbox = sinon.sandbox.create();
        delayStub = sandbox.stub(Promise, 'delay', () => Promise.resolve(true));
      });

      after(function () {
        delayStub.restore();
      });

      describe('#provision', function () {
        const payload = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'VirtualHost',
          metadata: {
            name: instance_id,
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            options: JSON.stringify({
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
                dedicated_rabbitmq_instance: `${instance_name}`
              }
            })
          },
          status: {
            state: 'in_queue',
            lastOperation: '{}',
            response: '{}'
          }
        };

        const payload2 = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'VirtualHost',
          metadata: {
            name: instance_id,
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            options: JSON.stringify({
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
                dedicated_rabbitmq_instance: `${instance_name}`
              }
            })
          },
          status: {
            state: 'succeeded',
            lastOperation: '{}',
            response: '{}'
          }
        };
        const payload3 = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'VirtualHost',
          metadata: {
            name: instance_id,
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            options: JSON.stringify({
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
                dedicated_rabbitmq_instance: `${instance_name}`
              }
            })
          },
          status: {
            state: 'failed',
            error: utils.buildErrorJson(new NotFound(''))
          }
        };
        it('returns 201 created', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, {}, 1, payload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, payload2, 1);
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}`)
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
              expect(res).to.have.status(201);
              expect(res.body.dashboard_url).to.equal(dashboard_url);
              mocks.verify();
            });
        });
        it('returns 404 not found when wrong service instance name is passed.', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, {}, 1, payload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, payload3, 1);
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}`)
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
            .catch(res => {
              expect(res).to.have.status(404);
              mocks.verify();
            });
        });
      });

      describe('#bind', function () {
        const bindPayload = {
          apiVersion: 'bind.servicefabrik.io/v1alpha1',
          kind: 'VirtualHostBind',
          metadata: {
            name: binding_id,
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            options: utils.encodeBase64({
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
            })
          },
          status: {
            state: 'in_queue',
            lastOperation: '{}',
            response: '{}'
          }
        };

        const bindPayload2 = {
          apiVersion: 'bind.servicefabrik.io/v1alpha1',
          kind: 'VirtualHostBind',
          metadata: {
            name: binding_id,
            labels: {
              state: 'succeeded'
            }
          },
          spec: {
            options: JSON.stringify({
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
            })
          },
          status: {
            state: 'succeeded',
            lastOperation: '{}',
            response: utils.encodeBase64(mocks.virtualHostAgent.credentials)
          }
        };

        it('returns 201 Created', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, bindPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, binding_id, bindPayload2, 1);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, binding_id, {
            'status': {
              'response': '{}'
            }
          }, 1);
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
                credentials: mocks.virtualHostAgent.credentials
              });
            });
        });
      });

      describe('#unbind', function () {
        const unbindPayload = {
          apiVersion: 'bind.servicefabrik.io/v1alpha1',
          kind: 'DockerBind',
          metadata: {
            name: binding_id,
            labels: {
              state: 'delete'
            }
          },
          spec: {
            options: JSON.stringify({
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
            })
          },
          status: {
            state: 'delete',
            lastOperation: '{}',
            response: '{}'
          }
        };
        const unbindPayload2 = {
          apiVersion: 'bind.servicefabrik.io/v1alpha1',
          kind: 'DockerBind',
          metadata: {
            name: binding_id,
            labels: {
              state: 'succeeded'
            }
          },
          spec: {
            options: JSON.stringify({
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
            })
          },
          status: {
            state: 'succeeded',
            lastOperation: '{}',
            response: JSON.stringify(mocks.virtualHostAgent.credentials)
          }
        };
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, binding_id, unbindPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, binding_id, unbindPayload2, 1);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, binding_id, unbindPayload2, 1);
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

      describe('#deprovision', function () {
        const payload = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'VirtualHost',
          metadata: {
            name: instance_id,
            labels: {
              state: 'delete'
            }
          },
          spec: {
            options: JSON.stringify({
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
            })
          },
          status: {
            state: 'delete',
            lastOperation: '{}',
            response: '{}'
          }
        };

        const payload2 = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'VirtualHost',
          metadata: {
            name: instance_id,
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            options: JSON.stringify({
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
            })
          },
          status: {
            state: 'succeeded',
            lastOperation: '{}',
            response: '{}'
          }
        };
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, payload2, 1);
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
              expect(res).to.have.status(200);
              mocks.verify();
            });
        });
        it('returns 410 Gone when parent service instance is deleted', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, {}, 1, 404);
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
              mocks.verify();
            });
        });
      });
    });
  });
});