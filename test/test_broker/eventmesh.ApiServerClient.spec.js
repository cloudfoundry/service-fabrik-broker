'use strict';

const nock = require('nock');
const apiserver = require('../../data-access-layer/eventmesh').apiServerClient;
const apiServerHost = 'https://127.0.0.1:9443';
const CONST = require('../../common/constants');
const logger = require('../../common/logger');

const expectedGetDeploymentResponse = {
  metadata: {
    name: 'deployment1',
    labels: {
      label1: 'label1',
      label2: 'label2',
      last_backup_defaultbackups: 'backup1'
    }
  },
  spec: {
    options: JSON.stringify({
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
    }
  },
  spec: {
    options: {
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

function verify() {
  /* jshint expr:true */
  if (!nock.isDone()) {
    logger.error('pending mocks: %j', nock.pendingMocks());
  }
  expect(nock.isDone()).to.be.true;
}

function nockGetResource(resourceGroup, resourceType, id, response, expectedExpectedCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/${id}`)
    .reply(expectedExpectedCode || 200, response);
}

function nockPatchResourceStatus(resourceGroup, resourceType, id, response, payload, expectedExpectedCode) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/${id}/status`, JSON.stringify(payload))
    .reply(expectedExpectedCode || 200, response);
}

function nockPatchResource(resourceGroup, resourceType, id, response, payload, expectedExpectedCode) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/${id}`, JSON.stringify(payload))
    .reply(expectedExpectedCode || 200, response);
}

function nockCreateResource(resourceGroup, resourceType, response, payload, expectedExpectedCode) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}`, JSON.stringify(payload))
    .reply(expectedExpectedCode || 201, response);
}

function nockDeleteResource(resourceGroup, resourceType, id, response, expectedExpectedCode) {
  nock(apiServerHost)
    .delete(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/${id}`)
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
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR
        });
      });
    });

    describe('createResource', () => {
      it('Creates resource without label and status', () => {
        const expectedResponse = {};
        const payload = {
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
        nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, expectedResponse, payload);
        return apiserver.createResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            parentResourceId: 'deployment1',
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
        const payload1 = {
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
        const payload2 = {
          status: {
            state: 'create',
            response: JSON.stringify({
              resp: 'resp'
            })
          }
        };
        nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, {}, payload1);
        nockPatchResourceStatus(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload2);
        return apiserver.createResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            parentResourceId: 'deployment1',
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
            parentResourceId: 'deployment1',
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
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload);
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
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload);
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

      it('Updates resource with label, options and status', () => {
        const expectedResponse = {
          res: 'res'
        };
        const payload1 = {
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
        const payload2 = {
          status: {
            state: 'create',
            response: JSON.stringify({
              resp: 'resp'
            })
          }
        };
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', {}, payload1);
        nockPatchResourceStatus(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload2);
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
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload1, 404);
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

    describe('patchResponse', () => {
      it('Patches response with given fields', () => {
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
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedGetResponse);
        nockPatchResourceStatus(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload);
        return apiserver.patchResponse({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            response: {
              resp: 'resp1',
              resp2: 'resp2'
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql({});
            verify();
          });
      });
    });

    describe('patchOptions', () => {
      it('Patches options with given fields', () => {
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
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedGetResponse);
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload);
        return apiserver.patchOptions({
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
    });

    describe('deleteResource', () => {
      it('Deletes resource', () => {
        const expectedResponse = {};
        nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse);
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
      it('Throws error when delete fails', () => {
        nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', {}, 404);
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
        nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedResponse, payload);
        return apiserver.updateLastOperation({
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
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedGetDeploymentResponse);
        return apiserver.getResource({
            resourceId: 'deployment1',
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          })
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource);
            verify();
          });
      });
    });

    describe('getLastOperation', () => {
      it('Gets last operation on resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedGetDeploymentResponse);
        return apiserver.getLastOperation({
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

    describe('getOptions', () => {
      it('Gets options of resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedGetDeploymentResponse);
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
      it('Gets options of resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedGetDeploymentResponse);
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

    describe('getState', () => {
      it('Gets options of resource', () => {
        nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, 'deployment1', expectedGetDeploymentResponse);
        return apiserver.getState({
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


  });
});