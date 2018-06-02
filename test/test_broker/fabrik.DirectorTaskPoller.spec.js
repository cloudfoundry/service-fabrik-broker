'use strict';

const proxyquire = require('proxyquire');

describe('fabrik', function () {
  const params = {
    test: 'val'
  };
  const args = {
    test: 'arg'
  };
  describe('DirectorTaskPoller', () => {
    let subject;
    let sandbox;
    let codSpy, getNamesSpy, getDeploymentSpy, getPlanSpy, subscribeSpy, startSpy;
    let boshCache;

    beforeEach(() => {
      sandbox = sinon.sandbox.create();
      codSpy = sandbox.stub();
      getNamesSpy = sandbox.stub();
      getDeploymentSpy = sandbox.stub();
      getPlanSpy = sandbox.stub();
      subscribeSpy = sandbox.stub();
      startSpy = sandbox.stub();
      boshCache = {
        getDeploymentNames: getNamesSpy,
        getDeploymentByName: getDeploymentSpy
      };
      subject = proxyquire('../../broker/lib/fabrik/DirectorTaskPoller', {
        '../bosh': {
          BoshOperationQueue: boshCache
        },
        '../models/catalog': {
          getPlan: getPlanSpy
        },
        './DirectorManager': {
          load: function () {
            return {
              createOrUpdateDeployment: codSpy
            };
          }
        },
        '../config': {
          enable_bosh_rate_limit: true
        },
        'pubsub-js': {
          subscribe: subscribeSpy
        }
      });
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should have subscribed to the app startup event', () => {
      expect(subscribeSpy.calledOnce).to.eql(true);
      expect(subscribeSpy.args[0][0]).to.eql('APP.STARTUP');
      startSpy.returns({});
      subject.start = startSpy;
      let innerFn = subscribeSpy.args[0][1];
      innerFn('APP.STARTUP', {
        type: 'internal'
      });
      expect(startSpy.calledOnce).to.eql(true);
    });

    it('should consume any error thrown from the action handler: getDeploymentNames', () => {
      getNamesSpy.returns(Promise.reject(new Error('get_error')));
      getDeploymentSpy.returns(Promise.resolve({
        plan_id: 'plan',
        params: params,
        args: args
      }));
      codSpy.returns(Promise.resolve());
      subject.action().then(() => {
        expect(getNamesSpy.callCount).to.eql(1);
        expect(getDeploymentSpy.callCount).to.eql(0);
        expect(getPlanSpy.callCount).to.eql(0);
        expect(codSpy.callCount).to.eql(0);
      });
    });
    it('should consume any error thrown from the action handler: getDeploymentByName', () => {
      getNamesSpy.returns(Promise.resolve(['1', '2', '3']));
      getDeploymentSpy.returns(Promise.reject(new Error('deployment_error')));
      codSpy.returns(Promise.resolve());
      subject.action().then(() => {
        expect(getNamesSpy.callCount).to.eql(1);
        expect(getDeploymentSpy.callCount).to.eql(3);
        expect(getPlanSpy.callCount).to.eql(0);
        expect(codSpy.callCount).to.eql(0);
      });
    });
    it('should call the action handler successfully', () => {
      getNamesSpy.returns(Promise.resolve(['1', '2', '3']));
      getDeploymentSpy.returns(Promise.resolve({
        plan_id: 'plan',
        params: params,
        args: args
      }));
      codSpy.returns(Promise.resolve());
      subject.action().then(() => {
        expect(getNamesSpy.callCount).to.eql(1);
        expect(getDeploymentSpy.callCount).to.eql(3);
        expect(getDeploymentSpy.firstCall.calledWithExactly('1')).to.eql(true);
        expect(getDeploymentSpy.secondCall.calledWithExactly('2')).to.eql(true);
        expect(getDeploymentSpy.thirdCall.calledWithExactly('3')).to.eql(true);
        expect(getPlanSpy.callCount).to.eql(3);
        expect(getPlanSpy.firstCall.calledWithExactly('plan')).to.eql(true);
        expect(getPlanSpy.secondCall.calledWithExactly('plan')).to.eql(true);
        expect(getPlanSpy.thirdCall.calledWithExactly('plan')).to.eql(true);
        expect(codSpy.callCount).to.eql(3);
        expect(codSpy.firstCall.calledWithExactly('1', params, args)).to.eql(true);
        expect(codSpy.secondCall.calledWithExactly('2', params, args)).to.eql(true);
        expect(codSpy.thirdCall.calledWithExactly('3', params, args)).to.eql(true);
      });
    });
  });
});