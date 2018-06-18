'use strict';

const nock = require('nock');
const swagger = require('./apiserver-swagger.json');
const apiserver = require('../../eventmesh').server;
const apiServerHost = 'https://10.0.2.2:9443';
const lib = require('../../broker/lib');
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

function nockPatchResourceStatus(resourceGroup, resourceType, id, response) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}/status`)
    .reply(200, response);
}

function nockPatchResource(resourceGroup, resourceType, id, response) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .reply(200, response);
}

function nockCreateResource(resourceGroup, resourceType, response) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s`)
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
      it.only('updates the specified resource state', done => {
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

    });

    describe('updateAnnotationResult', () => {

    });


    describe('updateAnnotationState', () => {

    });

    describe('updateLastAnnotation', () => {

    });

    describe('getLastAnnotation', () => {

    });

    describe('getAnnotationOptions', () => {

    });

    describe('getAnnotationState', () => {

    });

    describe('getAnnotationResult', () => {

    });


  });
});