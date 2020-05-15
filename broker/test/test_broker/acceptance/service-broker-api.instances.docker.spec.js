'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const app = require('../support/apps').internal;
const docker = require('../../../data-access-layer/docker');
const config = require('@sf/app-config');
const {
  CONST,
  commonFunctions: {
    encodeBase64
  }
} = require('@sf/common-utils');
const camelcaseKeys = require('camelcase-keys');

describe('service-broker-api', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('docker', function () {
      const base_url = '/cf/v2';
      const api_version = '2.12';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = 'b3e03cb5-29cc-4fcf-9900-023cf149c554';
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const parameters = {
        foo: 'bar'
      };
      const usedPorts = [38782, 44635];
      const docker_url = parseUrl(config.docker.url);
      const protocol = config.external.protocol;
      const host = config.external.host;
      const username = 'user';
      const password = 'secret';

      const payload = {
        apiVersion: 'osb.servicefabrik.io/v1alpha1',
        kind: 'SFServiceInstance',
        metadata: {
          finalizers: ['broker.servicefabrik.io'],
          name: instance_id,
          labels: {
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
          state: 'in_queue'
        }
      };

      const payloadK8s = {
        apiVersion: 'osb.servicefabrik.io/v1alpha1',
        kind: 'SFServiceInstance',
        metadata: {
          finalizers: ['broker.servicefabrik.io'],
          name: instance_id,
          labels: {
            state: 'in_queue'
          }
        },
        spec: {
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'kubernetes',
            namespace: 'default'
          },
          organization_guid: organization_guid,
          space_guid: space_guid,
          parameters: {
            foo: 'bar'
          }
        },
        status: {
          state: 'in_queue'
        }
      };


      const payload2 = {
        apiVersion: 'osb.servicefabrik.io/v1alpha1',
        kind: 'SFServiceInstance',
        metadata: {
          finalizers: ['broker.servicefabrik.io'],
          name: instance_id,
          labels: {
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

      const payload2K8s = {
        apiVersion: 'osb.servicefabrik.io/v1alpha1',
        kind: 'SFServiceInstance',
        metadata: {
          finalizers: ['broker.servicefabrik.io'],
          name: instance_id,
          labels: {
            state: 'in_queue'
          }
        },
        spec: {
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'kubernetes',
            namespace: 'default'
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
      let sandbox, delayStub;

      before(function () {
        mocks.docker.getAllContainers(usedPorts);
        sandbox = sinon.createSandbox();
        delayStub = sandbox.stub(Promise, 'delay').callsFake(() => Promise.resolve(true));
        return mocks.setup([
          docker.updatePortRegistry()
        ]);
      });

      afterEach(function () {
        mocks.reset();
      });

      after(function () {
        delayStub.restore();
      });

      describe('#updatePortRegistry', function () {
        it('returns all used tcp ports', function () {
          expect(docker.portRegistry.getPorts('tcp')).to.eql([33331].concat(usedPorts));
        });
      });

      describe('#provision', function () {
        it('returns 201 Created', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);

          const testPayload2 = _.cloneDeep(payload2);
          testPayload2.spec = camelcaseKeys(payload2.spec);

          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
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
              expect(res.body).to.eql({
                dashboard_url: `${protocol}://${host}/manage/dashboards/docker/instances/${instance_id}`
              });
              mocks.verify();
            });
        });

        it('returns 201 Created - start fails once internally', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);

          const testPayload2 = _.cloneDeep(payload2);
          testPayload2.spec = camelcaseKeys(payload2.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
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
              expect(res.body).to.eql({
                dashboard_url: `${protocol}://${host}/manage/dashboards/docker/instances/${instance_id}`
              });
              mocks.verify();
            });
        });

        it('returns 201 Created: For K8S', function () {
          const testPayload = _.cloneDeep(payloadK8s);
          testPayload.spec = camelcaseKeys(payloadK8s.spec);

          const testPayload2 = _.cloneDeep(payload2K8s);
          testPayload2.spec = camelcaseKeys(payload2K8s.spec);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, {}, 1, testPayload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'kubernetes',
                namespace: 'default'
              },
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters
            })
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                dashboard_url: `${protocol}://${host}/manage/dashboards/docker/instances/${instance_id}`
              });
              mocks.verify();
            });
        });

      });

      describe('#update', function () {
        it('returns 200 OK', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);

          const testPayload2 = _.cloneDeep(payload2);
          testPayload2.spec = camelcaseKeys(payload2.spec);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, { spec: { parameters: null } });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2 , 1);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}`)
            .send({
              service_id: service_id,
              plan_id: plan_id,
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
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                dashboard_url: `${protocol}://${host}/manage/dashboards/docker/instances/${instance_id}`
              });
              mocks.verify();
            });
        });
        it('returns 200 OK : For K8S', function () {
          const testPayload = _.cloneDeep(payloadK8s);
          testPayload.spec = camelcaseKeys(payloadK8s.spec);

          const testPayload2 = _.cloneDeep(payload2K8s);
          testPayload2.spec = camelcaseKeys(payload2K8s.spec);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, { spec: { parameters: null } });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 1);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}`)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              parameters: parameters,
              context: {
                platform: 'kubernetes',
                namespace: 'default'
              },
              previous_values: {
                plan_id: plan_id,
                service_id: service_id
              }
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                dashboard_url: `${protocol}://${host}/manage/dashboards/docker/instances/${instance_id}`
              });
              mocks.verify();
            });
        });

      });

      describe('#deprovision', function () {
        const payload = {
          apiVersion: 'osb.servicefabrik.io/v1alpha1',
          kind: 'SFServiceInstance',
          metadata: {
            finalizers: ['broker.servicefabrik.io'],
            name: instance_id,
            labels: {
              state: 'delete'
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
            state: 'delete'
          }
        };

        const payloadK8s = {
          apiVersion: 'osb.servicefabrik.io/v1alpha1',
          kind: 'SFServiceInstance',
          metadata: {
            finalizers: ['broker.servicefabrik.io'],
            name: instance_id,
            labels: {
              state: 'delete'
            }
          },
          spec: {
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'kubernetes',
              namespace: 'default'
            },
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: {
              foo: 'bar'
            }
          },
          status: {
            state: 'delete'
          }
        };


        const payload2 = {
          apiVersion: 'osb.servicefabrik.io/v1alpha1',
          kind: 'SFServiceInstance',
          metadata: {
            finalizers: ['broker.servicefabrik.io'],
            name: instance_id,
            labels: {
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

        const payload2K8s = {
          apiVersion: 'osb.servicefabrik.io/v1alpha1',
          kind: 'SFServiceInstance',
          metadata: {
            finalizers: ['broker.servicefabrik.io'],
            name: instance_id,
            labels: {
              state: 'in_queue'
            }
          },
          spec: {
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'kubernetes',
              namespace: 'default'
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
        it('returns 200 OK', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);

          const testPayload2 = _.cloneDeep(payload2);
          testPayload2.spec = camelcaseKeys(payload2.spec);
          const payLoadForRemovalOfFinalizer = {
            metadata: {
              finalizers: []
            }
          };
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload, 1);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, payLoadForRemovalOfFinalizer, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 2);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 2);
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it('returns 410 Gone', function () {
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, 404);
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
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

        it('returns 200 OK: for existing deployment not having platfrom-context in environment', function () {
          const testPayload = _.cloneDeep(payload);
          testPayload.spec = camelcaseKeys(payload.spec);

          const testPayload2 = _.cloneDeep(payload2);
          testPayload2.spec = camelcaseKeys(payload2.spec);
          const payLoadForRemovalOfFinalizer = {
            metadata: {
              finalizers: []
            }
          };
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload, 1);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, payLoadForRemovalOfFinalizer, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 2);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 2);
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it('returns 200 OK: In K8S platform', function () {
          const testPayload = _.cloneDeep(payloadK8s);
          testPayload.spec = camelcaseKeys(payloadK8s.spec);

          const testPayload2 = _.cloneDeep(payload2K8s);
          testPayload2.spec = camelcaseKeys(payload2K8s.spec);

          const payLoadForRemovalOfFinalizer = {
            metadata: {
              finalizers: []
            }
          };
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload, 1);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, payLoadForRemovalOfFinalizer, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 2);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, testPayload2, 2);
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

      });

      describe('#bind', function () {
        const bindPayload = {
          apiVersion: 'osb.servicefabrik.io/v1alpha1',
          kind: 'SFServiceBinding',
          metadata: {
            finalizers: ['broker.servicefabrik.io'],
            name: binding_id,
            labels: {
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
            state: 'in_queue'
          }
        };

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
        const secretData = {
          hostname: docker_url.hostname,
          username: username,
          password: password,
          ports: {
            '12345/tcp': 12345
          },
          uri: `http://${username}:${password}@${docker_url.hostname}`
        };
        it('returns 201 Created', function () {
          const testPayload = _.cloneDeep(bindPayload);
          testPayload.spec = camelcaseKeys(bindPayload.spec);

          const testPayload2 = _.cloneDeep(bindPayload2);
          testPayload2.spec = camelcaseKeys(bindPayload2.spec);

          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, testPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS, binding_id, testPayload2, 1);
          mocks.apiServerEventMesh.nockGetSecret(binding_id, _.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE), {
            data: {
              response: encodeBase64({ credentials: secretData })
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
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              }
            })
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                credentials: {
                  hostname: docker_url.hostname,
                  username: username,
                  password: password,
                  ports: {
                    '12345/tcp': 12345
                  },
                  uri: `http://${username}:${password}@${docker_url.hostname}`
                }
              });
              mocks.verify();
            });
        });
      });

      describe('#unbind', function () {
        it('returns 200 OK', function () {
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

        it('returns 200 OK: for existing deployment not having platfrom-context in environment', function () {
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

        it('returns 200 OK: In K8S Platform', function () {
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
      describe('docker-deprecated-plans', function () {
        const plan_id = '61a8d1f7-6477-4eb7-a85d-57ac067e80c4';

        before(function () {
          mocks.docker.getAllContainers(usedPorts);
          return mocks.setup([
            docker.updatePortRegistry()
          ]);
        });

        afterEach(function () {
          mocks.reset();
        });

        describe('#provision', function () {
          it('returns 403 for deprecated plan', function () {
            return chai.request(app)
              .put(`${base_url}/service_instances/${instance_id}`)
              .set('X-Broker-API-Version', api_version)
              .auth(config.username, config.password)
              .send({
                service_id: service_id,
                plan_id: plan_id,
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
        });
      });
    });
  });
});
