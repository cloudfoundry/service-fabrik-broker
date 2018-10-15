'use strict';

const _ = require('lodash');
const CONST = require('../../common/constants');
const proxyquire = require('proxyquire');
const BaseStatusPoller = require('../../managers/BaseStatusPoller');

describe('managers', function () {
  describe('BoshStaggeredDeploymentPoller', function () {

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
          state: 'succeeded'
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
        state: 'succeeded',
        lastOperation: {},
        response: {
          service_id: 'service_id',
          plan_id: 'plan_id',
          context: {
            platform: 'cloudfoundry',
            organization_guid: 'organization_guid',
            space_guid: 'space_guid'
          },
          organization_guid: 'organization_guid',
          space_guid: 'space_guid',
          deployment_name: 'deployment_name'
        }
      }
    };
    let sandbox, initStub, clearPollerStub, createOrUpdateDeploymentStub;
    beforeEach(function () {
      sandbox = sinon.sandbox.create();
      initStub = sandbox.stub(BaseStatusPoller.prototype, 'init');
      clearPollerStub = sandbox.stub(BaseStatusPoller.prototype, 'clearPoller');
      createOrUpdateDeploymentStub = sandbox.stub();
    });

    afterEach(function () {
      sandbox.restore();
    });

    after(function () {
      sandbox.restore();
    });

    describe('#getStatus', function () {
      it('cached deployment status check should be succesful and status is in_progress', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshStaggeredDeploymentPoller = proxyquire('../../managers/bosh-manager/BoshStaggeredDeploymentPoller.js', {
          './DirectorService': {
            'createInstance': function (instance_id, options) {
              /* jshint unused:false */
              return Promise.resolve({
                'createOrUpdateDeployment': createOrUpdateDeploymentStub
              });
            }
          }
        });
        const boshStaggeredDeploymentPoller = new BoshStaggeredDeploymentPoller();
        createOrUpdateDeploymentStub.withArgs('deployment_name', _.get(resourceBody, 'spec.options')).onCall(0).returns(Promise.resolve({
          task_id: 'task_id',
          cached: false
        }));
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, () => {
          return true;
        });
        return boshStaggeredDeploymentPoller.getStatus(resourceBody, 'interval_id')
          .spread((res, interval) => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(createOrUpdateDeploymentStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(1);
            mocks.verify();
            done();
          })
          .catch(done);
      });

      it('cached deployment status check should be succesful and status is waiting', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns(Promise.resolve());
        const BoshStaggeredDeploymentPoller = proxyquire('../../managers/bosh-manager/BoshStaggeredDeploymentPoller.js', {
          './DirectorService': {
            'createInstance': function (instance_id, options) {
              /* jshint unused:false */
              return Promise.resolve({
                'createOrUpdateDeployment': createOrUpdateDeploymentStub
              });
            }
          }
        });
        const boshStaggeredDeploymentPoller = new BoshStaggeredDeploymentPoller();
        createOrUpdateDeploymentStub.withArgs('deployment_name', _.get(resourceBody, 'spec.options')).onCall(0).returns(Promise.resolve({
          cached: true
        }));
        return boshStaggeredDeploymentPoller.getStatus(resourceBody, 'interval_id')
          .then(() => {
            expect(createOrUpdateDeploymentStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(0);
            expect(initStub.callCount).to.be.eql(1);
            mocks.verify();
            done();
          })
          .catch(done);
      });

      it('cached deployment status check should be unsuccessful', function (done) {
        initStub.returns(Promise.resolve());
        clearPollerStub.returns();
        const BoshStaggeredDeploymentPoller = proxyquire('../../managers/bosh-manager/BoshStaggeredDeploymentPoller.js', {
          './DirectorService': {
            'createInstance': function (instance_id, options) {
              /* jshint unused:false */
              return Promise.resolve({
                'createOrUpdateDeployment': createOrUpdateDeploymentStub
              });
            }
          }
        });
        const boshStaggeredDeploymentPoller = new BoshStaggeredDeploymentPoller();
        createOrUpdateDeploymentStub.withArgs('deployment_name', _.get(resourceBody, 'spec.options')).onCall(0).returns(Promise.reject({}));
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, () => {
          return true;
        });
        return boshStaggeredDeploymentPoller.getStatus(resourceBody, 'interval_id')
          .then(res => {
            /* jshint unused:false */
            expect(res.statusCode).to.be.eql(200);
            expect(res.body).to.be.eql({});
            expect(createOrUpdateDeploymentStub.callCount).to.be.eql(1);
            expect(initStub.callCount).to.be.eql(1);
            expect(clearPollerStub.callCount).to.be.eql(1);
            mocks.verify();
            done();
          })
          .catch(done);
      });

    });
  });
});