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
    describe('multitenancy', function () {
      const base_url = '/cf/v2';
      const api_version = '2.12';
      const service_id = '6db542eb-8187-4afc-8a85-e08b4a3cc24e';
      const plan_id = '2fcf6682-5a4a-4297-a7cd-a97bbe085b8e';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'fe171a35-3107-4cee-bc6b-0051617f892e';
      const instance_id = 'b3e03cb5-29cc-4fcf-9900-023cf149c554';
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const instance_name = 'postgresSharedInstance';
      const parameters = {
        dedicated_instance: `${instance_name}`
      };
      const index = mocks.director.networkSegmentIndex;
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const accepts_incomplete = true;
      const protocol = config.external.protocol;
      const host = config.external.host;
      const dashboard_url = `${protocol}://${host}/manage/dashboards/postgresql/instances/${instance_id}`;
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
          kind: 'PostgresqlMT',
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
                dedicated_instance: `${instance_name}`
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
          kind: 'PostgresqlMT',
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
                dedicated_instance: `${instance_name}`
              }
            })
          },
          status: {
            state: 'succeeded',
            lastOperation: '{}',
            response: '{}'
          },
          operatorMetadata: {
            dedicatedInstanceDeploymentName: `${deployment_name}`
          }
        };

        const payload3 = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'PostgresqlMT',
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
                dedicated_instance: `${instance_name}`
              }
            })
          },
          status: {
            state: 'failed',
            error: utils.buildErrorJson(new NotFound(''))
          }
        };

        it('returns 201 created', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, {}, 1, payload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, payload2, 1);
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
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, {}, 1, payload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, payload3, 1);
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
          kind: 'PostgresqlMTBind',
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
          kind: 'PostgresqlMTBind',
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
            response: utils.encodeBase64(mocks.multitenancyAgent.credentials)
          }
        };

        it('returns 201 Created', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, bindPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, binding_id, bindPayload2, 1);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, binding_id, {
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
                credentials: mocks.multitenancyAgent.credentials
              });
            });
        });
      });

      describe('#unbind', function () {
        const unbindPayload = {
          apiVersion: 'bind.servicefabrik.io/v1alpha1',
          kind: 'PostgresqlMTBind',
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
          kind: 'PostgresqlMTBind',
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
            response: JSON.stringify(mocks.multitenancyAgent.credentials)
          }
        };

        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, binding_id, unbindPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, binding_id, unbindPayload2, 1);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, binding_id, unbindPayload2, 1);
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
          kind: 'PostgresqlMT',
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
          kind: 'PostgresqlMT',
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, payload2, 1);
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, {}, 1, 404);
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