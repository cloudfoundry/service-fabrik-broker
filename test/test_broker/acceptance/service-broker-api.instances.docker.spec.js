'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const lib = require('../../../broker/lib');
const app = require('../support/apps').internal;
const catalog = require('../../../common/models').catalog;
const docker = require('../../../data-access-layer/docker');
const config = require('../../../common/config');
const CONST = require('../../../common/constants');
const utils = require('../../../common/utils');
const fabrik = lib.fabrik;

describe('service-broker-api', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('docker', function () {
      const base_url = '/cf/v2';
      const api_version = '2.12';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
      const plan = catalog.getPlan(plan_id);
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
        apiVersion: 'deployment.servicefabrik.io/v1alpha1',
        kind: 'Docker',
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
          state: 'in_queue',
          lastOperation: '{}',
          response: '{}'
        }
      };

      const payloadK8s = {
        apiVersion: 'deployment.servicefabrik.io/v1alpha1',
        kind: 'Docker',
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
              platform: 'kubernetes',
              namespace: 'default'
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


      const payload2 = {
        apiVersion: 'deployment.servicefabrik.io/v1alpha1',
        kind: 'Docker',
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

      const payload2K8s = {
        apiVersion: 'deployment.servicefabrik.io/v1alpha1',
        kind: 'Docker',
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
              platform: 'kubernetes',
              namespace: 'default'
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
      let sandbox, delayStub;

      before(function () {
        _.unset(fabrik.DockerManager, plan_id);
        mocks.docker.inspectImage();
        mocks.docker.getAllContainers(usedPorts);
        sandbox = sinon.sandbox.create();
        delayStub = sandbox.stub(Promise, 'delay', () => Promise.resolve(true));
        return mocks.setup([
          fabrik.DockerManager.load(plan),
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

          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, {}, 1, payload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2, 1);
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
                dashboard_url: `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id}`
              });
              mocks.verify();
            });
        });

        it('returns 201 Created - start fails once internally', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, {}, 1, payload);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2, 1);
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
                dashboard_url: `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id}`
              });
              mocks.verify();
            });
        });

        it('returns 201 Created: For K8S', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, {}, 1, payloadK8s);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2K8s, 1);
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
                dashboard_url: `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id}`
              });
              mocks.verify();
            });
        });

      });

      describe('#update', function () {
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2, 1);
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
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
        it('returns 200 OK : For K8S', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payloadK8s, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2K8s, 1);
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
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

      });

      describe('#deprovision', function () {
        const payload = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'Docker',
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

        const payloadK8s = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'Docker',
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
                platform: 'kubernetes',
                namespace: 'default'
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
          kind: 'Docker',
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

        const payload2K8s = {
          apiVersion: 'deployment.servicefabrik.io/v1alpha1',
          kind: 'Docker',
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
                platform: 'kubernetes',
                namespace: 'default'
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2, 1);
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, {}, 1, 404);
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2, 1);
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payloadK8s, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, payload2K8s, 1);
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
          apiVersion: 'bind.servicefabrik.io/v1alpha1',
          kind: 'DockerBind',
          metadata: {
            name: binding_id,
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
            state: 'in_queue',
            lastOperation: '{}',
            response: '{}'
          }
        };

        const bindPayload2 = {
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
            response: utils.encodeBase64({
              hostname: docker_url.hostname,
              username: username,
              password: password,
              ports: {
                '12345/tcp': 12345
              },
              uri: `http://${username}:${password}@${docker_url.hostname}`
            })
          }
        };
        it('returns 201 Created', function () {
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, bindPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, bindPayload2, 1);
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
        const unbindPayloadK8s = {
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
                platform: 'kubernetes',
                namespace: 'default'
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
            response: JSON.stringify({
              hostname: docker_url.hostname,
              username: username,
              password: password,
              ports: {
                '12345/tcp': 12345
              },
              uri: `http://${username}:${password}@${docker_url.hostname}`
            })
          }
        };
        const unbindPayload2K8s = {
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
                platform: 'kubernetes',
                namespace: 'default'
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
            response: JSON.stringify({
              hostname: docker_url.hostname,
              username: username,
              password: password,
              ports: {
                '12345/tcp': 12345
              },
              uri: `http://${username}:${password}@${docker_url.hostname}`
            })
          }
        };
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload2, 1);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload2, 1);
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload2, 1);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload2, 1);
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
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayloadK8s, 1);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload2K8s, 1);
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, binding_id, unbindPayload2K8s, 1);
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
        const plan = catalog.getPlan(plan_id);

        before(function () {
          _.unset(fabrik.DockerManager, plan_id);
          mocks.docker.inspectImage();
          mocks.docker.getAllContainers(usedPorts);
          return mocks.setup([
            fabrik.DockerManager.load(plan),
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