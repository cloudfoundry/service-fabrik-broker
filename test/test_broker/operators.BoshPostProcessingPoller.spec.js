'use strict';

const _ = require('lodash');
const CONST = require('../../common/constants');
const proxyquire = require('proxyquire');
const BaseStatusPoller = require('../../operators/BaseStatusPoller');

describe('operators', function () {
  describe('BoshPostProcessingPoller', function () {

    const index = mocks.director.networkSegmentIndex;
    const instance_id = mocks.director.uuidByIndex(index);
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';

    const resourceBody = {
      apiVersion: 'deployment.servicefabrik.io/v1alpha1',
      kind: 'Director',
      metadata: {
        annotations: {
          lockedByManager: '',
          lockedByTaskPoller: '{\"lockTime\":\"2018-09-06T16:38:34.919Z\",\"ip\":\"10.0.2.2\"}'
        },
        creationTimestamp: '2018-09-06T16:01:28Z',
        generation: 1,
        labels: {
          state: 'post_processing'
        },
        name: instance_id,
        namespace: 'default',
        resourceVersion: '3364',
        selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
        uid: '1d48b3f3-b1ee-11e8-ac2a-06c007f8352b'
      },
      spec: {
        options: {
          service_id: 'service_id',
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry',
            organization_guid: 'organization_guid',
            space_guid: 'space_guid'
          },
          organization_guid: 'organization_guid',
          space_guid: 'space_guid'
        }
      },
      status: {
        state: 'post_processing',
        lastOperation: {
          type: 'create',
          parameters: {'foo': 'bar'},
          context: {
            platform: 'cloudfoundry',
            organization_guid: 'organization_guid',
            space_guid: 'space_guid'
          },
          task_id: 'task_id',
          deployment_name: 'deployment_name',
          description: 'description',
          state: 'succeeded',
          resourceState: 'succeeded'
        },
        response: {
          type: 'create',
          context: {
            platform: 'cloudfoundry',
            organization_guid: 'organization_guid',
            space_guid: 'space_guid'
          },
          deployment_name: 'deployment_name',
          task_id: "task_id"
        }
      }
    };


    let sandbox, initStub, clearPollerStub, createStub, updateStub, deleteStub, getAgentPostProcessingStatusStub;
    beforeEach(function () {
      sandbox = sinon.createSandbox();
      initStub = sandbox.stub(BaseStatusPoller.prototype, 'init');
      clearPollerStub = sandbox.stub(BaseStatusPoller.prototype, 'clearPoller');
      createStub = sandbox.stub();
      updateStub = sandbox.stub();
      deleteStub = sandbox.stub();
      getAgentPostProcessingStatusStub = sandbox.stub();
    });

    afterEach(function () {
      sandbox.restore();
    });

    after(function () {
      sandbox.restore();
    });

    describe('#getStatus', function () {
      it('create postprocessing should stay as long as it is processing', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshPostProcessingPoller = proxyquire('../../operators/bosh-operator/BoshPostProcessingPoller.js', {
          './DirectorService': {
            'createInstance': function () {
              /* jshint unused:false */
              return Promise.resolve({
                'getAgentPostProcessingStatus': getAgentPostProcessingStatusStub
              });
            }
          }
        });
        const boshPostProcessingPoller = new BoshPostProcessingPoller();
        const resourceBodyCopy = _.cloneDeep(resourceBody);
        const type = 'create';
        resourceBodyCopy.status.lastOperation.type = type;
        resourceBodyCopy.status.response.type = type;
        getAgentPostProcessingStatusStub
          .withArgs(type, 'deployment_name')
          .onCall(0)
          .returns(Promise.resolve({
            state: CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING,
            stage: 'Step 3/5',
            update_at: new Date().toISOString()
          }));
        const expectedPayload = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, expectedPayload);
        return boshPostProcessingPoller.getStatus(resourceBodyCopy, 'interval_id')
          .spread((res) => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(getAgentPostProcessingStatusStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(0);
            mocks.verify();
            done();
          })
          .catch(done);
      });

      it('update postprocessing should stay as long as it is processing', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshPostProcessingPoller = proxyquire('../../operators/bosh-operator/BoshPostProcessingPoller.js', {
          './DirectorService': {
            'createInstance': function () {
              /* jshint unused:false */
              return Promise.resolve({
                'getAgentPostProcessingStatus': getAgentPostProcessingStatusStub
              });
            }
          }
        });
        const boshPostProcessingPoller = new BoshPostProcessingPoller();
        const resourceBodyCopy = _.cloneDeep(resourceBody);
        const type = 'update';
        resourceBodyCopy.status.lastOperation.type = type;
        resourceBodyCopy.status.response.type = type;
        getAgentPostProcessingStatusStub
          .withArgs(type, 'deployment_name')
          .withArgs(resourceBodyCopy.status.response.type, resourceBodyCopy.status.response.deployment_name)
          .onCall(0)
          .returns(Promise.resolve({
            state: CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING,
            stage: 'Step 3/5',
            update_at: new Date().toISOString()
          }));
        const expectedPayload = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, expectedPayload);
        return boshPostProcessingPoller.getStatus(resourceBodyCopy, 'interval_id')
          .spread((res) => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(getAgentPostProcessingStatusStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(0);
            mocks.verify();
            done();
          })
          .catch(done);
      });

      it('create postprocessing should succeed', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshPostProcessingPoller = proxyquire('../../operators/bosh-operator/BoshPostProcessingPoller.js', {
          './DirectorService': {
            'createInstance': function () {
              /* jshint unused:false */
              return Promise.resolve({
                'getAgentPostProcessingStatus': getAgentPostProcessingStatusStub
              });
            }
          }
        });
        const boshPostProcessingPoller = new BoshPostProcessingPoller();
        const resourceBodyCopy = _.cloneDeep(resourceBody);
        const type = 'create';
        resourceBodyCopy.status.lastOperation.type = type;
        resourceBodyCopy.status.response.type = type;
        getAgentPostProcessingStatusStub
          .withArgs(type, 'deployment_name')
          .withArgs(resourceBodyCopy.status.response.type, resourceBodyCopy.status.response.deployment_name)
          .onCall(0)
          .returns(Promise.resolve({
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED,
            stage: 'Step 5/5',
            update_at: new Date().toISOString()
          }));
        const expectedPayload = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, expectedPayload);
        return boshPostProcessingPoller.getStatus(resourceBodyCopy, 'interval_id')
          .spread((res) => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(getAgentPostProcessingStatusStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(1);
            mocks.verify();
            done();
          })
          .catch(done);
      });

      it('update postprocessing should succeed', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshPostProcessingPoller = proxyquire('../../operators/bosh-operator/BoshPostProcessingPoller.js', {
          './DirectorService': {
            'createInstance': function () {
              /* jshint unused:false */
              return Promise.resolve({
                'getAgentPostProcessingStatus': getAgentPostProcessingStatusStub
              });
            }
          }
        });
        const boshPostProcessingPoller = new BoshPostProcessingPoller();
        const resourceBodyCopy = _.cloneDeep(resourceBody);
        const type = 'update';
        resourceBodyCopy.status.lastOperation.type = type;
        resourceBodyCopy.status.response.type = type;
        getAgentPostProcessingStatusStub
          .withArgs(type, 'deployment_name')
          .withArgs(resourceBodyCopy.status.response.type, resourceBodyCopy.status.response.deployment_name)
          .onCall(0)
          .returns(Promise.resolve({
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED,
            stage: 'Step 5/5',
            update_at: new Date().toISOString()
          }));
        const expectedPayload = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, expectedPayload);
        return boshPostProcessingPoller.getStatus(resourceBodyCopy, 'interval_id')
          .spread((res) => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(getAgentPostProcessingStatusStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(1);
            mocks.verify();
            done();
          })
          .catch(done);
      });

      it('create postprocessing should be able to fail', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshPostProcessingPoller = proxyquire('../../operators/bosh-operator/BoshPostProcessingPoller.js', {
          './DirectorService': {
            'createInstance': function () {
              /* jshint unused:false */
              return Promise.resolve({
                'getAgentPostProcessingStatus': getAgentPostProcessingStatusStub
              });
            }
          }
        });
        const boshPostProcessingPoller = new BoshPostProcessingPoller();
        const resourceBodyCopy = _.cloneDeep(resourceBody);
        const type = 'create';
        resourceBodyCopy.status.lastOperation.type = type;
        resourceBodyCopy.status.response.type = type;
        getAgentPostProcessingStatusStub
          .withArgs(type, 'deployment_name')
          .withArgs(resourceBodyCopy.status.response.type, resourceBodyCopy.status.response.deployment_name)
          .onCall(0)
          .returns(Promise.resolve({
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            stage: 'Step 3/5',
            update_at: new Date().toISOString()
          }));
        const expectedPayload = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, expectedPayload);
        return boshPostProcessingPoller.getStatus(resourceBodyCopy, 'interval_id')
          .spread((res) => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(getAgentPostProcessingStatusStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(1);
            mocks.verify();
            done();
          })
          .catch(done);
      });


      it('update postprocessing should be able to fail', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshPostProcessingPoller = proxyquire('../../operators/bosh-operator/BoshPostProcessingPoller.js', {
          './DirectorService': {
            'createInstance': function () {
              /* jshint unused:false */
              return Promise.resolve({
                'getAgentPostProcessingStatus': getAgentPostProcessingStatusStub
              });
            }
          }
        });
        const boshPostProcessingPoller = new BoshPostProcessingPoller();
        const resourceBodyCopy = _.cloneDeep(resourceBody);
        const type = 'update';
        resourceBodyCopy.status.lastOperation.type = type;
        resourceBodyCopy.status.response.type = type;
        getAgentPostProcessingStatusStub
          .withArgs(type, 'deployment_name')
          .withArgs(resourceBodyCopy.status.response.type, resourceBodyCopy.status.response.deployment_name)
          .onCall(0)
          .returns(Promise.resolve({
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            stage: 'Step 3/5',
            update_at: new Date().toISOString()
          }));
        const expectedPayload = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, expectedPayload);
        return boshPostProcessingPoller.getStatus(resourceBodyCopy, 'interval_id')
          .spread((res) => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(getAgentPostProcessingStatusStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(1);
            mocks.verify();
            done();
          })
          .catch(done);
      });

      it('no ops for deployment type unknown', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshPostProcessingPoller = proxyquire('../../operators/bosh-operator/BoshPostProcessingPoller.js', {
          './DirectorService': {}
        });
        const resourceBodyCopy = _.cloneDeep(resourceBody);
        resourceBodyCopy.status.lastOperation.type = 'random';
        resourceBodyCopy.status.response.type = 'random';
        const boshPostProcessingPoller = new BoshPostProcessingPoller();
        return boshPostProcessingPoller.getStatus(resourceBodyCopy, 'interval_id')
          .then(() => {
            expect(createStub.callCount).to.be.eql(0);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(0);
            done();
          })
          .catch(done);
      });

    });
  });
});