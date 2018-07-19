'use strict';

const _ = require('lodash');
const nock = require('nock');
const apiserver = require('../../data-access-layer/eventmesh').apiServerClient;
const apiServerHost = 'https://10.0.2.2:9443';
const CONST = require('../../common/constants');
const logger = require('../../common/logger');

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
    options: JSON.stringify({
      'lockDetails': 'lockdetails'
    })
  },
  status: {}
};

const sampleDeploymentResource = {
  kind: 'Director',
  apiVersion: 'deployment.servicefabrik.io/v1alpha1',
  metadata: {
    name: 'fakeResourceId',
    namespace: 'default',
    selfLink: '/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/fakeResourceId',
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
    name: 'fakeOperationId',
    namespace: 'default',
    selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/fakeOperationId',
    uid: '54e02d6c-72b6-11e8-80fe-9801a7b45ddd',
    resourceVersion: '1076',
    generation: 1,
    creationTimestamp: '2018-06-18T05:13:26Z'
  },
  spec: {
    options: 'sample_options'
  },
  status: {
    state: 'defaultState',
    error: JSON.stringify({
      name: 'defaultErrorObj'
    }),
    response: JSON.stringify({
      name: 'defaultResponseObj'
    }),
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
  describe('ApiServerClient', () => {

    afterEach(() => {
      nock.cleanAll();
    });
    describe('parseResourceDetailsFromSelfLink', () => {
      it('Should parse resource details from selflink', () => {
        const selfLink = '/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/sample_director';
        const resourceDetails = apiserver.parseResourceDetailsFromSelfLink(selfLink);
        expect(resourceDetails).to.deep.eql({
          resourceGroup: 'deployment',
          resourceType: 'directors'
        });
      });
    });

    describe('createLockResource', () => {
      it('calls the post rest api to create lock type resource', done => {
        nockCreateResource('lock', 'deploymentlock', sampleLockResource);
        apiserver.createLock('deploymentlock', sampleLockResource)
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
        return apiserver.createLock('deploymentlock', sampleLockResource)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('createResource', () => {
      it('throws error if api call is errored', done => {
        nockCreateResource('lock', 'deploymentlock', sampleLockResource, undefined, 409);
        return apiserver._createResource('lock', 'deploymentlock', sampleLockResource)
          .catch(err => {
            expect(err.code).to.eql(409);
            done();
          });
      });
    });

    describe('deleteLock', () => {
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
        apiserver.deleteLock('deploymentlock', 'l1')
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
        return apiserver.deleteLock('deploymentlock', 'l1')
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

    describe('getLockDetails', () => {
      it('returns options of the lock resource', done => {
        nockGetResource('lock', 'deploymentlock', 'l1', sampleLockResource);
        apiserver.getLockDetails('deploymentlock', 'l1')
          .then(res => {
            expect(res).to.eql(JSON.parse(sampleLockResource.spec.options));
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('lock', 'deploymentlock', 'l1', sampleLockResource, 409);
        return apiserver.getLockDetails('deploymentlock', 'l1')
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getResource', () => {
      it('returns the specified resource', done => {
        nockGetResource('deployment', 'director', 'fakeResourceId', sampleDeploymentResource);
        apiserver.getResource('deployment', 'director', 'fakeResourceId')
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(sampleDeploymentResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('deployment', 'director', 'fakeResourceId', sampleDeploymentResource, 409);
        return apiserver.getResource('deployment', 'director', 'fakeResourceId')
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('createDeployment', () => {
      const resourceId = 'fakeResourceId';
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
        nockPatchResourceStatus('deployment', 'director', 'fakeResourceId', finalResource, statusJson);
        apiserver.createDeployment(resourceId, val)
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
        return apiserver.createDeployment(resourceId, val)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('_updateResourceState', () => {
      it('updates the specified resource state', done => {
        nockPatchResourceStatus('deployment', 'director', 'fakeResourceId', sampleDeploymentResource);
        apiserver._updateResourceState('director', 'fakeResourceId', sampleDeploymentResource.status.state)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(sampleDeploymentResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('deployment', 'director', 'fakeResourceId', sampleDeploymentResource, undefined, 409);
        return apiserver._updateResourceState('director', 'fakeResourceId', sampleDeploymentResource.status.state)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getResourceState', () => {
      it('gets the specified resource state', done => {
        nockGetResource('deployment', 'director', 'fakeResourceId', sampleDeploymentResource);
        apiserver.getResourceState('director', 'fakeResourceId')
          .then(res => {
            expect(res).to.eql(sampleDeploymentResource.status.state);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('deployment', 'director', 'fakeResourceId', sampleDeploymentResource, 409);
        return apiserver.getResourceState('director', 'fakeResourceId')
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('createOperation', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackups',
        operationId: 'fakeOperationId',
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
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, statusJson);
        apiserver.createOperation(opts)
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
        return apiserver.createOperation(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateOperationError', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId',
        error: {
          key: 'value'
        }
      };
      const payload = {
        status: {
          error: JSON.stringify(opts.error),
        }
      };
      const response = _.assign({
        status: {
          error: JSON.stringify(opts.error)
        }
      }, sampleBackupResource);
      it('patches the operation error', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', response, payload);
        apiserver.updateOperationError(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(response);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', response, payload, 409);
        return apiserver.updateOperationError(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateOperationResponse', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId',
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
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input);
        apiserver.updateOperationResponse(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input, 409);
        return apiserver.updateOperationResponse(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateOperationStateAndResponse', () => {
      const opts = {
        resourceId: 'resource-guid',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'operation-guid',
        stateValue: 'fakeState',
        response: {
          key: 'fakeValue'
        }
      };
      const payload = {
        status: {
          state: opts.stateValue,
          response: JSON.stringify(opts.response),
        }
      };
      const finalResource = _.assign({
        status: {
          state: opts.stateValue,
          response: JSON.stringify(opts.response),
        }
      }, sampleBackupResource);
      it('updates the operation state and response', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'operation-guid', finalResource, payload);
        apiserver.updateOperationStateAndResponse(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', opts.operationId, finalResource, payload, 409);
        return apiserver.updateOperationStateAndResponse(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });


    describe('updateOperationState', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId',
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
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input);
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
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input, 409);
        return apiserver.updateOperationState(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('updateLastOperation', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        value: 'fakeOperationId'
      };
      const input = {};
      input.metadata = {};
      input.metadata.labels = {};
      input.metadata.labels[`last_${opts.operationName}_${opts.operationType}`] = opts.value;
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);

      it('updates the last operation value', done => {
        nockPatchResource('deployment', 'director', 'fakeResourceId', finalResource, input);
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
        nockPatchResource('deployment', 'director', 'fakeResourceId', finalResource, input, 409);
        return apiserver.updateLastOperation(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });

    });

    describe('getLastOperation', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup'
      };
      const input = {};
      input.metadata = {};
      input.metadata.labels = {};
      input.metadata.labels[`last_${opts.operationName}_${opts.operationType}`] = 'fakeOperationId';
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation value', done => {
        nockGetResource('deployment', 'director', 'fakeResourceId', finalResource);
        apiserver.getLastOperation(opts)
          .then(res => {
            expect(res).to.eql('fakeOperationId');
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('deployment', 'director', 'fakeResourceId', finalResource, 409);
        return apiserver.getLastOperation(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getOperationOptions', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId'
      };
      const input = {};
      input.spec = {};
      const options = {
        'options': 'opt'
      };
      input.spec.options = JSON.stringify(options);
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation options', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource);
        apiserver.getOperationOptions(opts)
          .then(res => {
            expect(res).to.eql(options);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource, 409);
        return apiserver.getOperationOptions(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getOperationState', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId'
      };
      const input = {};
      input.status = {};
      input.status.state = 'in_progress';
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation state', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource);
        apiserver.getOperationState(opts)
          .then(res => {
            expect(res).to.eql('in_progress');
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource, 409);
        return apiserver.getOperationState(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('getOperationResponse', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId'
      };
      const input = {};
      input.status = {};
      const response = {
        'response': 'res'
      };
      input.status.response = JSON.stringify(response);
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      _.assign(finalResource, input);
      it('gets the last operation Result', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource);
        apiserver.getOperationResponse(opts)
          .then(res => {
            expect(res).to.eql(response);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource, 409);
        return apiserver.getOperationResponse(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('#getOperationStatus', () => {
      const opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId'
      };
      const finalResource = _.cloneDeep(sampleDeploymentResource);
      it('gets the operation status', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource);
        apiserver.getOperationStatus(opts)
          .then(res => {
            expect(res).to.eql({
              state: 'in_progress'
            });
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockGetResource('backup', 'defaultbackup', 'fakeOperationId', finalResource, 409);
        return apiserver.getOperationStatus(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });

    describe('#updateOperationStatus', () => {
      let opts = {
        resourceId: 'fakeResourceId',
        operationName: 'backup',
        operationType: 'defaultbackup',
        operationId: 'fakeOperationId',
        stateValue: 'in_progress',
      };
      let input = {
        status: {
          state: opts.stateValue,
        }
      };
      let finalResource = _
        .chain(sampleBackupResource)
        .cloneDeep()
        .value();
      _.assign(finalResource.status, input.status);
      it('updates the operation status', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input);
        apiserver.updateOperationStatus(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            expect(res.body.status.state).to.eql(opts.stateValue);
            expect(res.body.status.error).to.eql(sampleBackupResource.status.error);
            done();
            verify();
          })
          .catch(done);
      });
      it('updates the operation status and error if both are present', done => {
        opts = {
          resourceId: 'fakeResourceId',
          operationName: 'backup',
          operationType: 'defaultbackup',
          operationId: 'fakeOperationId',
          stateValue: 'in_progress',
          error: {
            name: 'errorVal'
          }
        };
        input = {
          status: {
            state: opts.stateValue,
            error: JSON.stringify(opts.error)
          }
        };
        finalResource = _
          .chain(sampleBackupResource)
          .cloneDeep()
          .value();
        _.assign(finalResource.status, input.status);
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input);
        apiserver.updateOperationStatus(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            expect(res.body.status.state).to.eql(opts.stateValue);
            expect(res.body.status.error).to.eql(JSON.stringify(opts.error));
            done();
            verify();
          })
          .catch(done);
      });
      it('updates the operation error only and retain state', done => {
        opts = {
          resourceId: 'fakeResourceId',
          operationName: 'backup',
          operationType: 'defaultbackup',
          operationId: 'fakeOperationId',
          error: {
            name: 'errorVal'
          }
        };
        input = {
          status: {
            error: JSON.stringify(opts.error)
          }
        };
        finalResource = _
          .chain(sampleBackupResource)
          .cloneDeep()
          .value();
        _.assign(finalResource.status, input.status);
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input);
        apiserver.updateOperationStatus(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            expect(res.body.status.state).to.eql(sampleBackupResource.status.state);
            expect(res.body.status.error).to.eql(JSON.stringify(opts.error));
            done();
            verify();
          })
          .catch(done);
      });
      it('updates the operation response only and retain state and error', done => {
        opts = {
          resourceId: 'fakeResourceId',
          operationName: 'backup',
          operationType: 'defaultbackup',
          operationId: 'fakeOperationId',
          response: {
            name: 'fakeResponse'
          }
        };
        input = {
          status: {
            response: JSON.stringify(opts.response)
          }
        };
        finalResource = _
          .chain(sampleBackupResource)
          .cloneDeep()
          .value();
        _.assign(finalResource.status, input.status);
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input);
        apiserver.updateOperationStatus(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            expect(res.body.status.state).to.eql(sampleBackupResource.status.state);
            expect(res.body.status.error).to.eql(sampleBackupResource.status.error);
            expect(res.body.status.response).to.eql(JSON.stringify(opts.response));
            done();
            verify();
          })
          .catch(done);
      });
      it('updates the operation response, state and error', done => {
        opts = {
          resourceId: 'fakeResourceId',
          operationName: 'backup',
          operationType: 'defaultbackup',
          operationId: 'fakeOperationId',
          response: {
            name: 'fakeResponse'
          },
          stateValue: 'fakeState',
          error: {
            name: 'errorVal'
          }
        };
        input = {
          status: {
            response: JSON.stringify(opts.response),
            state: opts.stateValue,
            error: JSON.stringify(opts.error)
          }
        };
        finalResource = _
          .chain(sampleBackupResource)
          .cloneDeep()
          .value();
        _.assign(finalResource.status, input.status);
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input);
        apiserver.updateOperationStatus(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            expect(res.body.status.state).to.eql(input.status.state);
            expect(res.body.status.error).to.eql(input.status.error);
            expect(res.body.status.response).to.eql(input.status.response);
            done();
            verify();
          })
          .catch(done);
      });
      it('throws error if api call is errored', done => {
        nockPatchResourceStatus('backup', 'defaultbackup', 'fakeOperationId', finalResource, input, 409);
        return apiserver.updateOperationStatus(opts)
          .catch(err => {
            expect(err).to.have.status(409);
            done();
          });
      });
    });


  });
});