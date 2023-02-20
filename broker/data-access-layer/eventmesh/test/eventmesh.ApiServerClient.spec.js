'use strict';

const nock = require('nock');
const _ = require('lodash');
const {
  apiServerClient,
  utils: {
    getServiceCrdFromConfig
  }
} = require('@sf/eventmesh');
const apiserver = apiServerClient;
const {
  CONST
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const logger = require('@sf/logger');
const AssertionError = require('assert').AssertionError;

const apiServerHost = `https://${config.apiserver.ip}:${config.apiserver.port}`;

const expectedGetDeploymentResponse = {
  metadata: {
    name: 'deployment1',
    labels: {
      label1: 'label1',
      label2: 'label2',
      last_backup_defaultbackups: 'backup1'
    },
    creationTimestamp: '2018-09-26T20:45:28Z'
  },
  spec: {
    options: JSON.stringify({
      context: {
        platform: 'abc'
      },
      opt1: 'opt1',
      opt2: 'opt2'
    }),
    instanceId: 'deployment1'
  },
  status: {
    state: 'create',
    response: JSON.stringify({
      resp: 'resp'
    })
  }
};

const sampleDeploymentResource = {
  metadata: {
    name: 'deployment1',
    labels: {
      label1: 'label1',
      label2: 'label2',
      last_backup_defaultbackups: 'backup1'
    },
    creationTimestamp: '2018-09-26T20:45:28Z'
  },
  spec: {
    options: {
      context: {
        'platform': 'abc'
      },
      opt1: 'opt1',
      opt2: 'opt2'
    },
    instanceId: 'deployment1'
  },
  status: {
    state: 'create',
    response: {
      resp: 'resp'
    }
  }
};

const expectedConfigMapResponse = {
  apiVersion: 'v1',
  data: {
    disable_scheduled_update_blueprint: 'true'
  },
  kind: 'ConfigMap',
  metadata: {
    creationTimestamp: '2018-12-05T11:31:28Z',
    name: 'sfconfig',
    namespace: 'default',
    resourceVersion: '370255',
    selfLink: '/api/v1/namespaces/default/configmaps/sfconfig',
    uid: '4e47d831-f881-11e8-9055-123c04a61866'
  }
};

const expectedConfigMapResponse2 = {
  apiVersion: 'v1',
  data: {
    disable_scheduled_update_blueprint: 'true'
  },
  kind: 'ConfigMap',
  metadata: {
    creationTimestamp: '2018-12-05T11:31:28Z',
    name: 'sfconfig',
    namespace: 'default',
    resourceVersion: '370255',
    selfLink: '/api/v1/namespaces/default/configmaps/sfconfig',
    uid: '4e47d831-f881-11e8-9055-123c04a61866'
  }
};

function verify() {
  /* jshint expr:true */
  if (!nock.isDone()) {
    logger.error('pending mocks: %j', nock.pendingMocks());
  }
  expect(nock.isDone()).to.be.true;
}

function nockGetResource(resourceGroup, resourceType, id, namespaceId, response, expectedExpectedCode) {
  const namespace = namespaceId ? namespaceId : 'default';
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1alpha1/namespaces/${namespace}/${resourceType}/${id}`)
    .reply(expectedExpectedCode || 200, response);
}

function nockCreateConfigMap(response, expectedStatusCode, payload) {
  let ordered;
  if (!_.isUndefined(payload)) {
    ordered = {};
    Object.keys(payload).sort().forEach(function (key) {
      ordered[key] = payload[key];
    });
  }
  nock(apiServerHost)
    .post(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps`, JSON.stringify(ordered))
    .reply(expectedStatusCode || 200, response);
}

function nockGetConfigMap(response, expectedStatusCode) {
  nock(apiServerHost)
    .get(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps/${CONST.CONFIG.RESOURCE_NAME}`)
    .reply(expectedStatusCode || 200, response);
}

function nockUpdateConfigMap(response, expectedStatusCode, payload) {
  nock(apiServerHost)
    .patch(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps/${CONST.CONFIG.RESOURCE_NAME}`, JSON.stringify(payload))
    .reply(expectedStatusCode || 200, response);
}

function nockPatchResource(resourceGroup, resourceType, id, namespaceId, response, payload, expectedExpectedCode) {
  const namespace = namespaceId ? namespaceId : 'default';
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}/v1alpha1/namespaces/${namespace}/${resourceType}/${id}`, JSON.stringify(payload))
    .reply(expectedExpectedCode || 200, response);
}

function nockCreateResource(resourceGroup, resourceType, response, payload, expectedExpectedCode) {
  let ordered;
  if (!_.isUndefined(payload)) {
    ordered = {};
    Object.keys(payload).sort().forEach(function (key) {
      ordered[key] = payload[key];
    });
  }
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}`, JSON.stringify(ordered))
    .reply(expectedExpectedCode || 201, response);
}

function nockDeleteResource(resourceGroup, resourceType, id, namespaceId, response, expectedExpectedCode) {
  const namespace = namespaceId ? namespaceId : 'default';
  nock(apiServerHost)
    .delete(`/apis/${resourceGroup}/v1alpha1/namespaces/${namespace}/${resourceType}/${id}`)
    .reply(expectedExpectedCode || 200, response);
}

describe('eventmesh', () => {
  describe('ApiServerClient', () => {
    afterEach(() => {
      nock.cleanAll();
    });
    describe('parseResourceDetailsFromSelfLink', () => {
      it('Should parse resource details from selflink', () => {
        const selfLink = '/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/sample_director';
        const resourceDetails = apiserver.parseResourceDetailsFromSelfLink(selfLink);
        expect(resourceDetails).to.deep.eql({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceId: 'sample_director',
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR
        });
      });
    });

    describe('waitTillInstanceIsScheduled', () => {
      const instance_id = 'instance_id';
      const sfserviceinstance = {
        metadata: {
          name: instance_id
        },
        spec: {
          clusterId: 1,
          planId: 'plan_id',
          serviceId: 'service_id',
        }
      };
      it('Should return sfserviceinstance object if clusterId is set', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, sfserviceinstance);
        return apiserver.waitTillInstanceIsScheduled(instance_id)
          .then(res => {
            expect(res).to.eql(sfserviceinstance);
            mocks.verify();
          })
      });
      it('Should return sfserviceinstance object in multiple retries', () => {
        const sfserviceinstance1 = _.cloneDeep(sfserviceinstance);
        sfserviceinstance1.spec.clusterId = undefined;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, sfserviceinstance1);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, sfserviceinstance);
        return apiserver.waitTillInstanceIsScheduled(instance_id)
          .then(res => {
            expect(res).to.eql(sfserviceinstance);
            mocks.verify();
          })
      });
      it('Throws error if get sfserviceinstance returns error', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, {}, 1, 500);
        return apiserver.waitTillInstanceIsScheduled(instance_id)
          .catch(res => {
            expect(res).to.have.status(500);
            mocks.verify();
          })
      });
      it('Should throw error in case of timeout', () => {
        const sfserviceinstance1 = _.cloneDeep(sfserviceinstance);
        sfserviceinstance1.spec.clusterId = undefined;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, instance_id, sfserviceinstance1);
        return apiserver.waitTillInstanceIsScheduled(instance_id, 0.150)
          .catch(res => {
            expect(res).to.have.status(500);
            mocks.verify();
          })
      });
    });

    describe('registerCrds', () => {
      it('Register crd successfully for first time', () => {
        const crdJson = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
        mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJson.metadata.name, {}, crdJson);
        return apiserver.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR)
          .then(res => {
            expect(res.statusCode).to.eql(201);
            expect(res.body).to.eql({});
            mocks.verify();
          });
      });

      it('Patch already register crd successfully', () => {
        const crdJson = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
        mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJson.metadata.name, {}, crdJson, 409);
        mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJson.metadata.name, {}, crdJson);
        return apiserver.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            mocks.verify();
          });
      });

      it('Throw error in case of error', () => {
        const crdJson = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
        mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJson.metadata.name, {}, crdJson, 404);
        return apiserver.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR)
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });
    });

    describe('createResource', () => {
      it('Creates resource without label and status', () => {
        const crdJson = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
        const version = apiserver.getCrdVersion(crdJson)
        const expectedResponse = {};
        const payload = {
          apiVersion: `${crdJson.spec.group}/${version}`,
          kind: crdJson.spec.names.kind,
          metadata: {
            name: 'deployment1'
          },
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          }
        };
        nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, expectedResponse, payload);
        return apiserver.createResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            options: {
              opts: 'sample_options'
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(201);
            expect(res.body).to.eql({});
            verify();
          });
      });
      it('Creates resource without status', () => {
        const crdJson = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
        const version = apiserver.getCrdVersion(crdJson);
        const expectedResponse = {};
        const payload = {
          apiVersion: `${crdJson.spec.group}/${version}`,
          kind: crdJson.spec.names.kind,
          metadata: {
            name: 'deployment1',
            labels: {
              instance_guid: 'deployment1'
            }
          },
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          }
        };
        nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, expectedResponse, payload);
        return apiserver.createResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            labels: {
              instance_guid: 'deployment1'
            },
            options: {
              opts: 'sample_options'
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(201);
            expect(res.body).to.eql({});
            verify();
          });
      });
      it('Creates resource with label, options and status', () => {
        const expectedResponse = {
          res: 'res'
        };
        const crdJson = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
        const version = apiserver.getCrdVersion(crdJson)
        const payload1 = {
          apiVersion: `${crdJson.spec.group}/${version}`,
          kind: crdJson.spec.names.kind,
          metadata: {
            name: 'deployment1',
            labels: {
              instance_guid: 'deployment1',
              state: 'create'
            }
          },
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          },
          status: {
            state: 'create',
            response: JSON.stringify({
              resp: 'resp'
            })
          }
        };
        nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, expectedResponse, payload1);
        return apiserver.createResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            labels: {
              instance_guid: 'deployment1'
            },
            options: {
              opts: 'sample_options'
            },
            status: {
              state: 'create',
              response: {
                resp: 'resp'
              }
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(201);
            expect(res.body).to.eql(expectedResponse);
            verify();
          });
      });

      it('throws error if create api call is errored', () => {
        const expectedResponse = {
          res: 'res'
        };
        const crdJson = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
        const version = apiserver.getCrdVersion(crdJson)
        const payload1 = {
          apiVersion: `${crdJson.spec.group}/${version}`,
          kind: crdJson.spec.names.kind,
          metadata: {
            name: 'deployment1',
            labels: {
              instance_guid: 'deployment1'
            }
          },
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          }
        };
        nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, expectedResponse, payload1, 404);
        return apiserver.createResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            labels: {
              instance_guid: 'deployment1'
            },
            options: {
              opts: 'sample_options'
            }
          })
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });
    });

    describe('updateResource', () => {
      it('Updates resource without label and status', () => {
        const expectedResponse = {};
        const payload = {
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.updateResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            options: {
              opts: 'sample_options'
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

      it('Updates resource without status', () => {
        const expectedResponse = {};
        const payload = {
          metadata: {
            name: 'deployment1',
            labels: {
              instance_guid: 'deployment1'
            }
          },
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.updateResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            metadata: payload.metadata,
            options: {
              opts: 'sample_options'
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

      it('Updates resource with only status', () => {
        const expectedResponse = {};
        const payload = {
          metadata: {
            labels: {
              state: 'create'
            }
          },
          status: {
            state: 'create',
            response: JSON.stringify({
              resp: 'resp'
            })
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.updateResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            status: {
              state: 'create',
              response: {
                resp: 'resp'
              }
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

      it('Updates resource with label, options and status', () => {
        const expectedResponse = {
          res: 'res'
        };
        const payload1 = {
          metadata: {
            name: 'deployment1',
            labels: {
              instance_guid: 'deployment1',
              state: 'create'
            }
          },
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          },
          status: {
            state: 'create',
            response: JSON.stringify({
              resp: 'resp'
            })
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload1);
        return apiserver.updateResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            metadata: payload1.metadata,
            options: {
              opts: 'sample_options'
            },
            status: {
              state: 'create',
              response: {
                resp: 'resp'
              }
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(expectedResponse);
            verify();
          });
      });

      it('throws error if create api call is errored', () => {
        const expectedResponse = {
          res: 'res'
        };
        const payload1 = {
          spec: {
            options: JSON.stringify({
              opts: 'sample_options'
            })
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload1, 404);
        return apiserver.updateResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            options: {
              opts: 'sample_options'
            }
          })
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });
    });

    describe('patchResource', () => {
      it('Patches resource with response', () => {
        const expectedGetResponse = {
          status: {
            response: {
              resp: 'resp'
            }
          }
        };
        const expectedResponse = {};
        const payload = {
          status: {
            response: JSON.stringify({
              resp: 'resp1',
              resp2: 'resp2'
            })
          }
        };
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetResponse);
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.patchResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            status: {
              response: {
                resp: 'resp1',
                resp2: 'resp2'
              }
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

      it('Patches resource with options', () => {
        const expectedGetResponse = {
          spec: {
            options: {
              opt: 'opt'
            }
          }
        };
        const expectedResponse = {};
        const payload = {
          spec: {
            options: JSON.stringify({
              opt: 'opt1',
              opt2: 'opt2'
            })
          }
        };
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetResponse);
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.patchResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            options: {
              opt: 'opt1',
              opt2: 'opt2'
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

      it('Patches resource with all fields', () => {
        const expectedGetResponse = {
          metadata: {
            name: 'deployment1',
            labels: {
              instance_guid: 'deployment1'
            }
          },
          spec: {
            options: {
              opt1: 'opt1'
            }
          },
          status: {
            state: 'in_queue',
            response: {
              resp: 'resp',
              resp1: 'resp1'
            }
          }
        };
        const expectedResponse = {};
        const payload1 = {
          metadata: {
            labels: {
              instance_guid: 'deployment1',
              state: 'in_progress'
            }
          },
          spec: {
            options: JSON.stringify({
              opt1: 'opt1',
              opt2: 'sample_options'
            })
          },
          status: {
            state: 'in_progress',
            response: JSON.stringify({
              resp: 'resp1',
              resp1: 'resp1',
              resp2: 'resp2'
            })
          }
        };
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetResponse);
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload1);
        return apiserver.patchResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            metadata: {
              labels: {
                instance_guid: 'deployment1'
              }
            },
            options: {
              opt2: 'sample_options'
            },
            status: {
              state: 'in_progress',
              response: {
                resp: 'resp1',
                resp2: 'resp2'
              }
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

    });

    describe('deleteResource', () => {
      it('Deletes resource', () => {
        const expectedResponse = {};
        nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', undefined, expectedResponse);
        return apiserver.deleteResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });
      it('Deletes interoperator resource along with namespace', () => {
        const expectedResponse = {};
        nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, 'deployment1', 'namespace', expectedResponse);
        mocks.apiServerEventMesh.nockDeleteNamespace('namespace', {}, 1);
        config.apiserver.enable_namespaced_separation = true;
        return apiserver.deleteResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            namespaceId: 'namespace'
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
            config.apiserver.enable_namespaced_separation = false;
          });
      });
      it('Throws error when delete fails', () => {
        nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', undefined, {}, 404);
        return apiserver.deleteResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR
          })
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });
    });

    describe('updateLastOperation', () => {
      it('Updates last operation with given value', () => {
        const expectedResponse = {};
        const payload = {
          metadata: {
            labels: {
              last_backup_defaultbackups: 'backup1'
            }
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.updateLastOperationValue({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            value: 'backup1'
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });
    });

    describe('getResource', () => {
      it('Gets resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetDeploymentResponse);
        return apiserver.getResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR
          })
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource);
            verify();
          });
      });

      it('Gets resource list by state', () => {
        mocks.apiServerEventMesh.nockGetResourceListByState(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, [CONST.APISERVER.RESOURCE_STATE.WAITING], [expectedGetDeploymentResponse], 1, 200);
        return apiserver.getResourceListByState({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            stateList: [CONST.APISERVER.RESOURCE_STATE.WAITING]
          })
          .then(res => {
            expect(res).to.eql([sampleDeploymentResource]);
            verify();
          });
      });

      it('Gets resource list by state with empy array', () => {
        mocks.apiServerEventMesh.nockGetResourceListByState(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, [CONST.APISERVER.RESOURCE_STATE.WAITING], [], 1, 200);
        return apiserver.getResourceListByState({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            stateList: [CONST.APISERVER.RESOURCE_STATE.WAITING]
          })
          .then(res => {
            expect(res).to.eql([]);
            verify();
          });
      });

      it('Gets resource list by state: error', () => {
        mocks.apiServerEventMesh.nockGetResourceListByState(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, [CONST.APISERVER.RESOURCE_STATE.WAITING], [expectedGetDeploymentResponse], 1, 404);
        return apiserver.getResourceListByState({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            stateList: [CONST.APISERVER.RESOURCE_STATE.WAITING]
          })
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });

    });

    describe('getLastOperation', () => {
      it('Gets last operation on resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetDeploymentResponse);
        return apiserver.getLastOperationValue({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP
          })
          .then(res => {
            expect(res).to.eql('backup1');
            verify();
          });
      });
    });

    describe('getOperationStatus', () => {
      it('Gets operation status on resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetDeploymentResponse);
        return apiserver.getResourceStatus({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP
          })
          .then(res => {
            expect(res.state).to.eql(expectedGetDeploymentResponse.status.state);
            expect(res.response).to.eql(JSON.parse(expectedGetDeploymentResponse.status.response));
            verify();
          });
      });
    });

    describe('getOptions', () => {
      it('Gets options of resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetDeploymentResponse);
        return apiserver.getOptions({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            operationName: CONST.OPERATION_TYPE.BACKUP
          })
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource.spec.options);
            verify();
          });
      });
    });

    describe('getResponse', () => {
      it('Gets response of resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetDeploymentResponse);
        return apiserver.getResponse({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            operationName: CONST.OPERATION_TYPE.BACKUP
          })
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource.status.response);
            verify();
          });
      });
    });

    describe('getResourceState', () => {
      it('Gets state of resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetDeploymentResponse);
        return apiserver.getResourceState({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            operationName: CONST.OPERATION_TYPE.BACKUP
          })
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource.status.state);
            verify();
          });
      });
    });

    describe('createConfigMapResource', () => {
      it('Creates a new config map resource', () => {
        const payload = {
          apiVersion: 'v1',
          data: {
            disable_scheduled_update_blueprint: 'true'
          },
          kind: 'ConfigMap',
          metadata: {
            name: 'sfconfig'
          }
        };
        nockCreateConfigMap(expectedConfigMapResponse, undefined, payload);
        const configParam = {
          key: 'disable_scheduled_update_blueprint',
          value: 'true'
        };
        return apiserver.createConfigMapResource(CONST.CONFIG.RESOURCE_NAME, configParam)
          .then(res => {
            expect(res.body.apiVersion).to.eql(CONST.APISERVER.CONFIG_MAP.API_VERSION);
            expect(res.body.data).to.eql({
              disable_scheduled_update_blueprint: 'true'
            });
            expect(res.body.kind).to.eql(CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND);
            expect(res.body.metadata.resourceVersion).to.eql('370255');
            expect(res.body.metadata.selfLink).to.eql(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps/${CONST.CONFIG.RESOURCE_NAME}`);
            verify();
          });
      });
      it('Throws an error if create config map api call is errored', () => {
        const payload = {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'sfconfig'
          },
          data: {
            disable_scheduled_update_blueprint: 'true'
          }
        };
        nockCreateConfigMap({}, 404, payload);
        const configParam = {
          key: 'disable_scheduled_update_blueprint',
          value: 'true'
        };
        return apiserver.createConfigMapResource(CONST.CONFIG.RESOURCE_NAME, configParam)
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });
    });

    describe('getConfigMapResource', () => {
      it('Retrieves an existing config map resource object', () => {
        nockGetConfigMap(expectedConfigMapResponse);
        return apiserver.getConfigMapResource(CONST.CONFIG.RESOURCE_NAME)
          .then(res => {
            expect(res.apiVersion).to.eql(CONST.APISERVER.CONFIG_MAP.API_VERSION);
            expect(res.data).to.eql({
              disable_scheduled_update_blueprint: 'true'
            });
            expect(res.kind).to.eql(CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND);
            expect(res.metadata.resourceVersion).to.eql('370255');
            expect(res.metadata.selfLink).to.eql(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps/${CONST.CONFIG.RESOURCE_NAME}`);
            verify();
          });
      });
      it('Throws a 404 error if config map resource doesnt exist', () => {
        nockGetConfigMap({}, 404);
        return apiserver.getConfigMapResource(CONST.CONFIG.RESOURCE_NAME)
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });
    });

    describe('getConfigMap', () => {
      it('Retrieves the key-value pair in the existing config map resource object', () => {
        nockGetConfigMap(expectedConfigMapResponse);
        return apiserver.getConfigMap(CONST.CONFIG.RESOURCE_NAME, 'disable_scheduled_update_blueprint')
          .then(res => {
            expect(res).to.eql('true');
            verify();
          });
      });
      it('If a config map is not found, the function returns undefined ', () => {
        nockGetConfigMap({}, 404);
        return apiserver.getConfigMap(CONST.CONFIG.RESOURCE_NAME, 'disable_scheduled_update_blueprint')
          .then(res => {
            expect(res).to.eql(undefined);
            verify();
          });
      });
    });

    describe('createUpdateConfigMapResource', () => {
      it('Creates a new config map resource, as it doesnt exist', () => {
        nockGetConfigMap({}, 404);
        const payload = {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'sfconfig'
          },
          data: {
            disable_scheduled_update_blueprint: 'true'
          }
        };
        nockCreateConfigMap(expectedConfigMapResponse, undefined, payload);
        const configParam = {
          key: 'disable_scheduled_update_blueprint',
          value: 'true'
        };
        return apiserver.createUpdateConfigMapResource(CONST.CONFIG.RESOURCE_NAME, configParam)
          .then(res => {
            expect(res.body.apiVersion).to.eql(CONST.APISERVER.CONFIG_MAP.API_VERSION);
            expect(res.body.data).to.eql({
              disable_scheduled_update_blueprint: 'true'
            });
            expect(res.body.kind).to.eql(CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND);
            expect(res.body.metadata.resourceVersion).to.eql('370255');
            expect(res.body.metadata.selfLink).to.eql(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps/${CONST.CONFIG.RESOURCE_NAME}`);
            verify();
          });
      });
      it('Updates an existing config map resource', () => {
        nockGetConfigMap(expectedConfigMapResponse);
        const payload = {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'sfconfig',
            resourceVersion: '370255'
          },
          data: {
            disable_scheduled_update_blueprint: 'false'
          }
        };
        nockUpdateConfigMap(expectedConfigMapResponse2, undefined, payload);
        const configParam = {
          key: 'disable_scheduled_update_blueprint',
          value: 'false'
        };
        return apiserver.createUpdateConfigMapResource(CONST.CONFIG.RESOURCE_NAME, configParam)
          .then(res => {
            expect(res.body.apiVersion).to.eql(CONST.APISERVER.CONFIG_MAP.API_VERSION);
            expect(res.body.data).to.eql({
              disable_scheduled_update_blueprint: 'true'
            });
            expect(res.body.kind).to.eql(CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND);
            expect(res.body.metadata.resourceVersion).to.eql('370255');
            expect(res.body.metadata.selfLink).to.eql(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps/${CONST.CONFIG.RESOURCE_NAME}`);
            verify();
          });
      });
    });


    describe('getPlatformContext', () => {
      it('Gets getPlatformContext', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', 'default', expectedGetDeploymentResponse);
        return apiserver.getPlatformContext({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR
          })
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource.spec.options.context);
            verify();
          });
      });
    });
    describe('createNamespace', () => {
      it('Creates namespace successfully without labels', () => {
        const payload = {
          kind: CONST.APISERVER.NAMESPACE_OBJECT,
          apiVersion: 'v1',
          metadata: {
            name: 'namespace1'
          }
        };
        config.apiserver.enable_namespaced_separation = true;
        mocks.apiServerEventMesh.nockCreateNamespace('namespace1', {}, 1, payload);
        return apiserver.createNamespace('namespace1')
          .then(res => {
            expect(res.body).to.eql({});
            mocks.verify();
            config.apiserver.enable_namespaced_separation = false;
          });
      });
      it('Doesnt create namespace if already present', () => {
        const payload = {
          kind: CONST.APISERVER.NAMESPACE_OBJECT,
          apiVersion: 'v1',
          metadata: {
            name: 'namespace1'
          }
        };
        config.apiserver.enable_namespaced_separation = true;
        mocks.apiServerEventMesh.nockCreateNamespace('namespace1', {}, 1, payload, 409);
        return apiserver.createNamespace('namespace1')
          .catch(err => {
            expect(err.status).to.eql(409);
            verify();
            config.apiserver.enable_namespaced_separation = false;
          });
      });
      it('Creates namespace successfully with labels', () => {
        config.apiserver.services_namespace_labels = {
          'app.kubernetes.io/managed-by': 'Interoperator',
          'pod-security.kubernetes.io/warn': 'restricted',
          'pod-security.kubernetes.io/warn-version': 'v1.25'
        }
        const payload = {
          kind: CONST.APISERVER.NAMESPACE_OBJECT,
          apiVersion: 'v1',
          metadata: {
            name: 'namespace1',
            labels: {
              'app.kubernetes.io/managed-by': 'Interoperator',
              'pod-security.kubernetes.io/warn': 'restricted',
              'pod-security.kubernetes.io/warn-version': 'v1.25'
            }
          }
        };
        config.apiserver.enable_namespaced_separation = true;
        mocks.apiServerEventMesh.nockCreateNamespace('namespace1', {}, 1, payload);
        return apiserver.createNamespace('namespace1')
          .then(res => {
            expect(res.body).to.eql({});
            mocks.verify();
            config.apiserver.enable_namespaced_separation = false;
          });
      });
    });

    describe('deleteNamespace', () => {
      it('Deletes namespace successfully', () => {
        mocks.apiServerEventMesh.nockDeleteNamespace('namespace1', {}, 1);
        return apiserver.deleteNamespace('namespace1')
          .then(res => {
            expect(res.body).to.eql({});
            mocks.verify();
          });
      });
      it('Throws error if delete namespace fails', () => {
        mocks.apiServerEventMesh.nockDeleteNamespace('namespace1', {}, 1, undefined, 500);
        return apiserver.deleteNamespace('namespace1')
          .catch(err => {
            expect(err.status).to.eql(500);
            verify();
          });
      });
    });
    describe('getNamespaceId', () => {
      it('returns resource namespace as default by if enable_namespaced_separation is false (default setting for BOSH based deployment)', () => {
        expect(apiServerClient.getNamespaceId('resource')).to.eql('default');
      });
      it('returns resource namespace by if enable_namespaced_separation is true', () => {
        config.apiserver.enable_namespaced_separation = true
        expect(apiServerClient.getNamespaceId('abcd-efgh')).to.eql('sf-abcd-efgh');
        config.apiserver.enable_namespaced_separation = false
      });
      it('returns resource namespace as default by if enable_namespaced_separation is false and services_namespace is not null', () => {
        config.apiserver.services_namespace = 'random'
        expect(apiServerClient.getNamespaceId('resource')).to.eql('random');
        config.apiserver.services_namespace = null
      });
    });
    describe('getSecret', () => {
      it('Gets secret successfully with namespace', () => {
        mocks.apiServerEventMesh.nockGetSecret('secret', 'namespace', {}, 1);
        return apiserver.getSecret('secret', 'namespace')
          .then(res => {
            expect(res).to.eql({});
            mocks.verify();
          });
      });
      it('Throws assertion error without namespace', () => {
        expect(apiserver.getSecret.bind(apiserver, 'secret')).to.throw(AssertionError);
      });
      it('Throws error if get secret call fails', () => {
        mocks.apiServerEventMesh.nockGetSecret('secret', 'namespace', {}, 1, 500);
        return apiserver.getSecret('secret', 'namespace')
          .catch(err => {
            expect(err.status).to.eql(500);
            verify();
          });
      });
    });
    describe('patchOSBResource', () => {
      it('Patches osb resource with spec and status', () => {
        const expectedResponse = {};
        const payload = {
          spec: {
            planId: 'plan2',
            serviceId: 'service2',
            context: {
              organization_guid: 'org2',
              space_guid: 'space2'
            }
          },
          metadata: {
            labels: {
              state: 'in_progress'
            }
          },
          status: {
            state: 'in_progress',
            description: ''
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.patchOSBResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            spec: {
              plan_id: 'plan2',
              service_id: 'service2',
              context: {
                organization_guid: 'org2',
                space_guid: 'space2'
              }
            },
            status: {
              state: 'in_progress',
              description: ''
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

      it('Patches osb resource in a namespace with spec and status', () => {
        const expectedResponse = {};
        const payload = {
          spec: {
            planId: 'plan2',
            serviceId: 'service2',
            context: {
              organization_guid: 'org2',
              space_guid: 'space2'
            },
            params: {
              foo: 'bar'
            }
          },
          metadata: {
            labels: {
              state: 'update'
            }
          },
          status: {
            state: 'update',
            description: ''
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, 'deployment1', 'default', expectedResponse, {
          spec: {
            parameters: null
          }
        });
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, 'deployment1', 'default', expectedResponse, payload);
        return apiserver.patchOSBResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            spec: {
              plan_id: 'plan2',
              service_id: 'service2',
              context: {
                organization_guid: 'org2',
                space_guid: 'space2'
              },
              params: {
                foo: 'bar'
              }
            },
            status: {
              state: 'update',
              description: ''
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });

      it('Patches osb resource fails with error', () => {
        const payload = {
          spec: {
            planId: 'plan2',
            serviceId: 'service2',
            context: {
              organization_guid: 'org2',
              space_guid: 'space2'
            }
          },
          metadata: {
            labels: {
              state: 'in_progress'
            }
          },
          status: {
            state: 'in_progress',
            description: ''
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES, 'deployment1', 'default', {}, undefined, 404);
        return apiserver.patchOSBResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            spec: {
              plan_id: 'plan2',
              service_id: 'service2',
              context: {
                organization_guid: 'org2',
                space_guid: 'space2'
              }
            },
            status: {
              state: 'in_progress',
              description: ''
            }
          })
          .catch(err => {
            expect(err.status).to.eql(404);
            verify();
          });
      });
    });

    describe('createOrUpdateServicePlan', () => {
      it('Create service crd successfully for first time', () => {
        const crdJson = getServiceCrdFromConfig(config.services[0]);
        mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, {}, 1, crdJson);
        return apiserver.createOrUpdateServicePlan(crdJson)
          .then(res => {
            expect(res.statusCode).to.eql(201);
            expect(res.body).to.eql({});
            mocks.verify();
          });
      });
      it('Patches service crd successfully', () => {
        const crdJson = getServiceCrdFromConfig(config.services[0]);
        mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, {}, 1, crdJson, 409);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, crdJson.metadata.name, {}, 1, crdJson);

        return apiserver.createOrUpdateServicePlan(crdJson)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            mocks.verify();
          });
      });
      it('Throws error service crd patch fails', () => {
        const crdJson = getServiceCrdFromConfig(config.services[0]);
        mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, {}, 1, crdJson, 409);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, crdJson.metadata.name, {}, 1, crdJson, 500);
        return apiserver.createOrUpdateServicePlan(crdJson)
          .catch(err => {
            expect(err.status).to.eql(500);
            mocks.verify();
          });
      });
    });
  });
});