'use strict';

const _ = require('lodash');
const nock = require('nock');
const swagger = require('./helper-files/apiserver-swagger.json');
const apiserver = require('../../eventmesh').apiServerClient;
const apiServerHost = 'https://10.0.2.2:9443';
const lib = require('../../broker/lib');
const CONST = require('../../common/constants');
const logger = lib.logger;

const sampleLockResource = {
  kind: 'DeploymentLock',
  apiVersion: 'lock.servicefabrik.io/v1alpha1',
  metadata: {
    name: 'l1',
    namespace: 'default',
    selfLink: '/apis/lock.servicefabrik.io/v1alpha1/namespaces/default/deploymentlocks/l1',
    uid: '54e02d6c-72b6-11e8-80fe-9801a7b45ddd',
    resourceVersion: '1076',
    generation: 1,
    creationTimestamp: '2018-06-18T05:13:26Z'
  },
  spec: {
    options: 'sample_options'
  },
  status: {}
};

const sampleDeploymentResource = {
  kind: 'Director',
  apiVersion: 'deployment.servicefabrik.io/v1alpha1',
  metadata: {
    name: 'd1',
    namespace: 'default',
    selfLink: '/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/d1',
    uid: '54e02d6c-72b6-11e8-80fe-9801a7b45ddd',
    resourceVersion: '1076',
    generation: 1,
    creationTimestamp: '2018-06-18T05:13:26Z'
  },
  spec: {
    options: 'sample_options'
  },
  status: {
    state: 'in_progress'
  }
};

const sampleBackupResource = {
  kind: 'DefaultBackup',
  apiVersion: 'backup.servicefabrik.io/v1alpha1',
  metadata: {
    name: 'b1',
    namespace: 'default',
    selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/b1',
    uid: '54e02d6c-72b6-11e8-80fe-9801a7b45ddd',
    resourceVersion: '1076',
    generation: 1,
    creationTimestamp: '2018-06-18T05:13:26Z'
  },
  spec: {
    options: 'sample_options'
  }
};

function verify() {
  /* jshint expr:true */
  if (!nock.isDone()) {
    // console.log('pending mocks: %j', nock.pendingMocks());
    logger.error('pending mocks: %j', nock.pendingMocks());
  }
  expect(nock.isDone()).to.be.true;
}

function nockGetResource(resourceGroup, resourceType, id, response, expectedExpectedCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .reply(expectedExpectedCode || 200, response);
}

function nockPatchResourceStatus(resourceGroup, resourceType, id, response, payload, expectedExpectedCode) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}/status`, payload)
    .reply(expectedExpectedCode || 200, response);
}

function nockPatchResource(resourceGroup, resourceType, id, response, payload, expectedExpectedCode) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`, payload)
    .reply(expectedExpectedCode || 200, response);
}

function nockCreateResource(resourceGroup, resourceType, response, payload, expectedExpectedCode) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s`, payload)
    .reply(expectedExpectedCode || 201, response);
}

function nockDeleteResource(resourceGroup, resourceType, id, response, expectedExpectedCode) {
  nock(apiServerHost)
    .delete(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .reply(expectedExpectedCode || 200, response);
}

describe('eventmesh', () => {
  describe('ApiServerEventMesh', () => {
    beforeEach(() => {
      nock(apiServerHost)
        .get('/swagger.json')
        .reply(200, swagger);
    });

    afterEach(() => {
      nock.cleanAll();
    });

    describe('createLockResource', () => {
      it('calls the post rest api to create lock type resource', done => {
        nockCreateResource('lock', 'deploymentlock', sampleLockResource);
        apiserver.createLockResource('lock', 'deploymentlock', sampleLockResource)
          .then(res => {
            expect(res.statusCode).to.eql(201);
            expect(res.body).to.eql(sampleLockResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockCreateResource('lock', 'deploymentlock', sampleLockResource, undefined, 409);
        return apiserver.createLockResource('lock', 'deploymentlock', sampleLockResource)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('createResource', () => {
      it('throws error if api call is errored', done => {
        nockCreateResource('lock', 'deploymentlock', sampleLockResource, undefined, 409);
        return apiserver.createResource('lock', 'deploymentlock', sampleLockResource)
          .catch(err => {
            expect(err.code).to.eql(409);
            done();
          });
      });
    });

    describe('deleteLockResource', () => {
      const deleteLockResponse = {
        kind: 'Status',
        apiVersion: 'v1',
        metadata: {},
        status: 'Success',
        details: {
          name: 'l1',
          group: 'lock.servicefabrik.io',
          kind: 'deploymentlocks',
          uid: '3576eca0-72b7-11e8-80fe-9801a7b45ddd'
        }
      };
      it('calls the delete rest api to delete lock type resource', done => {
        nockDeleteResource('lock', 'deploymentlock', 'l1', deleteLockResponse);
        apiserver.deleteLockResource('lock', 'deploymentlock', 'l1')
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(deleteLockResponse);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockDeleteResource('lock', 'deploymentlock', 'l1', deleteLockResponse, 409);
        return apiserver.deleteLockResource('lock', 'deploymentlock', 'l1')
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateResource', () => {
      it('calls the patch rest api to edit lock type resource', done => {
        nockPatchResource('lock', 'deploymentlock', 'l1', sampleLockResource);
        apiserver.updateResource('lock', 'deploymentlock', 'l1', {
            spec: {
              options: sampleLockResource.spec.options
            }
          })
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(sampleLockResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        const spec = {
          spec: {
            options: sampleLockResource.spec.options
          }
        };
        nockPatchResource('lock', 'deploymentlock', 'l1', sampleLockResource, spec, 409);
        return apiserver.updateResource('lock', 'deploymentlock', 'l1', spec)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getLockResourceOptions', () => {
      it('returns options of the lock resource', done => {
        nockGetResource('lock', 'deploymentlock', 'l1', sampleLockResource);
        apiserver.getLockResourceOptions('lock', 'deploymentlock', 'l1')
          .then(res => {
            expect(res).to.eql(sampleLockResource.spec.options);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('lock', 'deploymentlock', 'l1', sampleLockResource, 409);
        return apiserver.getLockResourceOptions('lock', 'deploymentlock', 'l1')
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getResource', () => {
      it('returns the specified resource', done => {
        nockGetResource('deployment', 'director', 'd1', sampleDeploymentResource);
        apiserver.getResource('deployment', 'director', 'd1')
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(sampleDeploymentResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('deployment', 'director', 'd1', sampleDeploymentResource, 409);
        return apiserver.getResource('deployment', 'director', 'd1')
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('createDeploymentResource', () => {
      const resourceId = 'd1';
      const resourceType = 'directors';
      const val = {
        key: 'value'
      };
      const input = {
        metadata: {
          name: `${resourceId}`,
          labels: {
            instance_guid: `${resourceId}`,
          }
        },
        spec: {
          options: JSON.stringify(val)
        },
      };

      const statusJson = {
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
          lastOperation: 'created',
          response: JSON.stringify({})
        }
      };
      const finalResource = _.assign({
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
          lastOperation: 'created',
          response: JSON.stringify({})
        }
      }, sampleDeploymentResource);

      it('Creates a resource', done => {
        nockCreateResource('deployment', 'director', sampleDeploymentResource, input);
        nockPatchResourceStatus('deployment', 'director', 'd1', finalResource, statusJson);
        apiserver.createDeploymentResource(resourceType, resourceId, val)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockCreateResource('deployment', 'director', sampleDeploymentResource, input, 409);
        return apiserver.createDeploymentResource(resourceType, resourceId, val)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateResourceState', () => {
      it('updates the specified resource state', done => {
        nockPatchResourceStatus('deployment', 'director', 'd1', sampleDeploymentResource);
        apiserver.updateResourceState('director', 'd1', sampleDeploymentResource.status.state)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(sampleDeploymentResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('deployment', 'director', 'd1', sampleDeploymentResource, undefined, 409);
        return apiserver.updateResourceState('director', 'd1', sampleDeploymentResource.status.state)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getResourceState', () => {
      it('gets the specified resource state', done => {
        nockGetResource('deployment', 'director', 'd1', sampleDeploymentResource);
        apiserver.getResourceState('director', 'd1')
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource.status.state);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('deployment', 'director', 'd1', sampleDeploymentResource, 409);
        return apiserver.getResourceState('director', 'd1')
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('createOperationResource', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackups',
        operationId: 'b1',
        value: {
          key: 'value'
        }
      };
      const input = {
        metadata: {
          name: `${opts.operationId}`,
          labels: {
            instance_guid: `${opts.resourceId}`,
          },
        },
        spec: {
          options: JSON.stringify(opts.value)
        },
      };

      const statusJson = {
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
          lastOperation: 'created',
          response: JSON.stringify({})
        }
      };
      const finalResource = _.assign({
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
          lastOperation: '',
          response: ''
        }
      }, sampleBackupResource);
      it('Creates an operation of a resource', done => {
        nockCreateResource('backup', 'defaultbackup', sampleBackupResource, input);
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, statusJson);
        apiserver.createOperationResource(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockCreateResource('backup', 'defaultbackup', sampleBackupResource, input, 409);
        return apiserver.createOperationResource(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateOperationResult', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'b1',
        value: {
          key: 'value'
        }
      };
      const input = {
        status: {
          response: JSON.stringify(opts.value),
        }
      };
      const finalResource = _.assign({
        status: {
          response: JSON.stringify(opts.value)
        }
      }, sampleBackupResource);
      it('updates the operation result', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, input);
        apiserver.updateOperationResult(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, input, 409);
        return apiserver.updateOperationResult(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });


    describe('updateOperationState', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'b1',
        stateValue: 'in_progress'
      };
      const input = {
        status: {
          state: opts.stateValue
        }
      };
      const finalResource = _.assign({
        status: {
          state: opts.stateValue
        }
      }, sampleBackupResource);
      it('updates the operation state', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, input);
        apiserver.updateOperationState(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, input, 409);
        return apiserver.updateOperationState(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateLastOperation', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackup',
        value: 'b1'
      };
      const input = {};
      input.metadata = {};
      input.metadata.labels = {};
      input.metadata.labels[`last_${opts.operationName}_${opts.operationType}`] = opts.value;
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);

      it('updates the last operation value', done => {
        nockPatchResource('deployment', 'director', 'd1', finalResource, input);
        apiserver.updateLastOperation(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResource('deployment', 'director', 'd1', finalResource, input, 409);
        return apiserver.updateLastOperation(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });

    });

    describe('getLastOperation', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackup'
      };
      const input = {};
      input.metadata = {};
      input.metadata.labels = {};
      input.metadata.labels[`last_${opts.operationName}_${opts.operationType}`] = 'b1';
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation value', done => {
        nockGetResource('deployment', 'director', 'd1', finalResource);
        apiserver.getLastOperation(opts)
          .then(res => {
            expect(res).to.eql('b1');
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('deployment', 'director', 'd1', finalResource, 409);
        return apiserver.getLastOperation(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getOperationOptions', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'b1'
      };
      const input = {};
      input.spec = {};
      input.spec.options = 'some_value';
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation options', done => {
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource);
        apiserver.getOperationOptions(opts)
          .then(res => {
            expect(res).to.eql('some_value');
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource, 409);
        return apiserver.getOperationOptions(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getOperationState', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'b1'
      };
      const input = {};
      input.status = {};
      input.status.state = 'in_progress';
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation state', done => {
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource);
        apiserver.getOperationState(opts)
          .then(res => {
            expect(res).to.eql('in_progress');
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource, 409);
        return apiserver.getOperationState(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getOperationResult', () => {
      const opts = {
        resourceId: 'd1',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'b1'
      };
      const input = {};
      input.status = {};
      input.status.response = 'some_response';
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation Result', done => {
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource);
        apiserver.getOperationResult(opts)
          .then(res => {
            expect(res).to.eql('some_response');
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource, 409);
        return apiserver.getOperationResult(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });


  });
});