'use strict';

const _ = require('lodash');
const nock = require('nock');
const swagger = require('./apiserver-swagger.json');
const apiserver = require('../../eventmesh').server;
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
}

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
}

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
}

function verify() {
  /* jshint expr:true */
  if (!nock.isDone()) {
    console.log('pending mocks: %j', nock.pendingMocks());
    logger.error('pending mocks: %j', nock.pendingMocks());
  }
  expect(nock.isDone()).to.be.true;
}

function nockGetResource(resourceGroup, resourceType, id, response) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .reply(200, response);
}

function nockPatchResourceStatus(resourceGroup, resourceType, id, response, payload) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}/status`, payload)
    .reply(200, response);
}

function nockPatchResource(resourceGroup, resourceType, id, response, payload) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`, payload)
    .reply(200, response);
}

function nockCreateResource(resourceGroup, resourceType, response, payload) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s`, payload)
    .reply(201, response);
}

function nockDeleteResource(resourceGroup, resourceType, id, response) {
  nock(apiServerHost)
    .delete(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .reply(200, response);
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
    })

    describe('registerWatcher', () => {
      it('returns the specified resource', () => {

      });
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
    });

    describe('deleteLockResource', () => {
      it('calls the delete rest api to delete lock type resource', done => {
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
        }
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
    });

    describe('updateLockResource', () => {
      it('calls the patch rest api to edit lock type resource', done => {
        nockPatchResource('lock', 'deploymentlock', 'l1', sampleLockResource);
        apiserver.updateLockResource('lock', 'deploymentlock', 'l1', {
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
    });

    describe('createResource', () => {

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
    });

    describe('annotateResource', () => {
      it('gets the specified resource state', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup',
          annotationId: 'b1',
          val: {
            key: 'value'
          }
        }
        const input = {
          "apiVersion": `${opts.annotationName}.servicefabrik.io/v1alpha1`,
          metadata: {
            "name": `${opts.annotationId}`,
            "labels": {
              instance_guid: `${opts.resourceId}`,
            },
          },
          spec: {
            "options": JSON.stringify(opts.val)
          },
        }

        const statusJson = {
          status: {
            state: CONST.APISERVER.STATE.IN_QUEUE,
            lastOperation: "",
            response: ""
          }
        }
        const finalResource = _.assign({
          status: {
            state: CONST.APISERVER.STATE.IN_QUEUE,
            lastOperation: "",
            response: ""
          }
        }, sampleBackupResource)
        nockCreateResource('backup', 'defaultbackup', sampleBackupResource, input);
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, statusJson);
        apiserver.annotateResource(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
    });

    describe('updateAnnotationResult', () => {
      it('updates the annotation result', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup',
          annotationId: 'b1',
          value: {
            key: 'value'
          }
        }
        const input = {
          "status": {
            "response": JSON.stringify(opts.value),
          }
        }
        const finalResource = _.assign({
          status: {
            response: JSON.stringify(opts.value)
          }
        }, sampleBackupResource)
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, input);
        apiserver.updateAnnotationResult(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
    });


    describe('updateAnnotationState', () => {
      it('updates the annotation state', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup',
          annotationId: 'b1',
          stateValue: 'in_progress'
        }
        const input = {
          "status": {
            "state": opts.stateValue
          }
        }
        const finalResource = _.assign({
          status: {
            state: opts.stateValue
          }
        }, sampleBackupResource)
        nockPatchResourceStatus('backup', 'defaultbackup', 'b1', finalResource, input);
        apiserver.updateAnnotationState(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
    });

    describe('updateLastAnnotation', () => {
      it('updates the last annotation value', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup',
          value: 'b1'
        }
        const input = {}
        input["metadata"] = {}
        input.metadata["labels"] = {}
        input.metadata.labels[`last_${opts.annotationName}_${opts.annotationType}`] = opts.value
        const finalResource = _.cloneDeep(sampleDeploymentResource);
        _.assign(finalResource, input);
        nockPatchResource('deployment', 'director', 'd1', finalResource, input);
        apiserver.updateLastAnnotation(opts)
          .then(res => {
            expect(res.statusCode).to.eql(200);
            expect(res.body).to.eql(finalResource);
            done();
            verify();
          })
          .catch(done);
      });
    });

    describe('getLastAnnotation', () => {
      it('gets the last annotation value', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup'
        }
        const input = {}
        input["metadata"] = {}
        input.metadata["labels"] = {}
        input.metadata.labels[`last_${opts.annotationName}_${opts.annotationType}`] = 'b1'
        const finalResource = _.cloneDeep(sampleDeploymentResource);
        _.assign(finalResource, input);
        nockGetResource('deployment', 'director', 'd1', finalResource);
        apiserver.getLastAnnotation(opts)
          .then(res => {
            expect(res).to.eql('b1');
            done();
            verify();
          })
          .catch(done);
      });
    });

    describe('getAnnotationOptions', () => {
      it('gets the last annotation options', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup',
          annotationId: 'b1'
        }
        const input = {}
        input["spec"] = {}
        input.spec["options"] = 'some_value'
        const finalResource = _.cloneDeep(sampleDeploymentResource);
        _.assign(finalResource, input);
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource);
        apiserver.getAnnotationOptions(opts)
          .then(res => {
            expect(res).to.eql('some_value');
            done();
            verify();
          })
          .catch(done);
      });
    });

    describe('getAnnotationState', () => {
      it('gets the last annotation state', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup',
          annotationId: 'b1'
        }
        const input = {}
        input["status"] = {}
        input.status["state"] = 'in_progress'
        const finalResource = _.cloneDeep(sampleDeploymentResource);
        _.assign(finalResource, input);
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource);
        apiserver.getAnnotationState(opts)
          .then(res => {
            expect(res).to.eql('in_progress');
            done();
            verify();
          })
          .catch(done);
      });
    });

    describe('getAnnotationResult', () => {
      it('gets the last annotation Result', done => {
        const opts = {
          resourceId: 'd1',
          annotationName: 'backup',
          annotationType: 'defaultbackup',
          annotationId: 'b1'
        }
        const input = {}
        input["status"] = {}
        input.status["response"] = 'some_response'
        const finalResource = _.cloneDeep(sampleDeploymentResource);
        _.assign(finalResource, input);
        nockGetResource('backup', 'defaultbackup', 'b1', finalResource);
        apiserver.getAnnotationResult(opts)
          .then(res => {
            expect(res).to.eql('some_response');
            done();
            verify();
          })
          .catch(done);
      });
    });


  });
});