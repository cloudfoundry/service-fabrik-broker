'use strict';

const proxyquire = require('proxyquire');
const Promise = require('bluebird');

const guid = 'guid';
const task_id = 'task_id';
const params = {
  parameters: {
    key: 'v1'
  },
  context: {}
};

const internal_params = {
  parameters: {
    key: 'v1',
    'service-fabrik-operation': mocks.uaa.jwtToken
  },
  context: {}
};



describe('fabrik', () => {
  describe('DirectorInstance - with ratelimits', function () {
    let configStub = {
      'enable_bosh_rate_limit': true
    };

    let lastOpWithoutTaskId;
    let DirectorInstanceSub;
    let directorInstance, manager;
    let sandbox;
    let initializeSpy, codSpy, finalizeSpy, getTaskSpy, getOpStateSpy, removeCachedTaskSpy;

    beforeEach(() => {
      lastOpWithoutTaskId = {
        type: 'create'
      };
      sandbox = sinon.sandbox.create();
      initializeSpy = sandbox.stub();
      initializeSpy.returns(Promise.resolve());
      finalizeSpy = sandbox.stub();
      getTaskSpy = sandbox.stub();
      removeCachedTaskSpy = sandbox.stub();
      codSpy = sandbox.stub();
      codSpy.returns(Promise.resolve({
        cached: true
      }));
      getOpStateSpy = sandbox.stub();
      manager = {
        createOrUpdateDeployment: codSpy,
        getDeploymentName: () => `deployment-${guid}`,
        verifyDeploymentLockStatus: () => Promise.resolve(),
        getCurrentOperationState: getOpStateSpy,
        getTask: getTaskSpy,
        getNetworkSegmentIndex: () => 2,
        cleanupOperation: removeCachedTaskSpy
      };
      DirectorInstanceSub = proxyquire('../../broker/lib/fabrik/DirectorInstance', {
        '../config': configStub
      });
      directorInstance = new DirectorInstanceSub(guid, manager);
      directorInstance.initialize = initializeSpy;
      directorInstance.finalize = finalizeSpy;
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should create with rate limits', () => {
      return directorInstance.create(params).then(out => {
        expect(out.cached).to.eql(true);
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update with rate limits', () => {
      return directorInstance.update(params).then(out => {
        expect(out.cached).to.eql(true);
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update with rate limits - internal operation', () => {
      return directorInstance.update(internal_params).then(out => {
        let expectedParams = params;
        expectedParams.scheduled = true;

        expect(out.cached).to.eql(true);
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(codSpy.args[0]).to.eql([`deployment-${guid}`, expectedParams, undefined]);
      });
    });
    it('should invoke last operation: op in progress - cached', () => {
      getOpStateSpy.returns({
        cached: true
      });
      return directorInstance.lastOperation(lastOpWithoutTaskId).then((out) => {
        expect(out.state).to.eql('in progress');
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(undefined);
        expect(out.description).to.eql(`Create deployment is still in progress`);
        expect(getTaskSpy.notCalled).to.eql(true);
      });
    });
    it('should invoke last operation: op in progress- task available', () => {
      removeCachedTaskSpy.returns(Promise.resolve());
      getOpStateSpy.returns({
        cached: false,
        task_id: task_id
      });
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'in progress'
      }));
      return directorInstance.lastOperation(lastOpWithoutTaskId).then((out) => {
        expect(out.state).to.eql('in progress');
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(undefined);
        expect(out.description).to.eql(`Create deployment deployment-${guid} is still in progress`);
        expect(removeCachedTaskSpy.calledOnce).to.eql(false);
      });
    });
    it('should invoke last operation: op done- task succeeded', () => {
      finalizeSpy.returns(Promise.resolve());
      removeCachedTaskSpy.returns(Promise.resolve());
      getOpStateSpy.returns({
        cached: false,
        task_id: task_id
      });
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'done'
      }));
      return directorInstance.lastOperation(lastOpWithoutTaskId).then((out) => {
        expect(out.state).to.eql('succeeded');
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(undefined);
        expect(out.description).to.include(`Create deployment deployment-${guid} succeeded`);
        expect(removeCachedTaskSpy.calledOnce).to.eql(true);
      });
    });
    it('should invoke last operation: op done- task succeeded [remove from etcd failed]', function () {
      this.timeout(20000);
      finalizeSpy.returns(Promise.resolve());
      removeCachedTaskSpy.returns(Promise.reject(new Error('etcd_error')));
      getOpStateSpy.returns({
        cached: false,
        task_id: task_id
      });
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'done'
      }));
      return directorInstance.lastOperation(lastOpWithoutTaskId).catch(err => {
        expect(err.message).to.eql('etcd_error');
        expect(removeCachedTaskSpy.calledOnce).to.eql(true);
      });
    });
  });
  describe('DirectorInstance- without ratelimits', () => {
    let configStub = {
      'enable_bosh_rate_limit': false
    };
    let DirectorInstanceSub;
    let directorInstance, manager;
    let sandbox;
    let initializeSpy, codSpy, getTaskSpy, finalizeSpy, removeCachedTaskSpy;
    let lastOpTaskId;

    beforeEach(() => {
      lastOpTaskId = {
        task_id: task_id,
        type: 'create'
      };
      sandbox = sinon.sandbox.create();
      removeCachedTaskSpy = sandbox.stub();
      initializeSpy = sandbox.stub();
      initializeSpy.returns(Promise.resolve());
      finalizeSpy = sandbox.stub();
      codSpy = sandbox.stub();
      codSpy.returns(Promise.resolve({
        task_id: task_id
      }));
      getTaskSpy = sandbox.stub();
      manager = {
        createOrUpdateDeployment: codSpy,
        getDeploymentName: () => `deployment-${guid}`,
        verifyDeploymentLockStatus: () => Promise.resolve(),
        getTask: getTaskSpy,
        getNetworkSegmentIndex: () => 2,
        cleanupOperation: removeCachedTaskSpy
      };
      DirectorInstanceSub = proxyquire('../../broker/lib/fabrik/DirectorInstance', {
        '../config': configStub
      });
      directorInstance = new DirectorInstanceSub(guid, manager);
      directorInstance.initialize = initializeSpy;
      directorInstance.finalize = finalizeSpy;
    });

    afterEach(() => {
      lastOpTaskId = null;
      sandbox.restore();
    });

    it('should create without rate limits', () => {
      return directorInstance.create(params).then(out => {
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update without rate limits', () => {
      return directorInstance.update(params).then(out => {
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update without rate limits - internal operation', () => {
      return directorInstance.update(internal_params).then(out => {
        let expectedParams = params;
        expectedParams.scheduled = true;
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(codSpy.args[0]).to.eql([`deployment-${guid}`, expectedParams, undefined]);
      });
    });
    it('should invoke last operation: op in progress', () => {
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'in progress'
      }));
      return directorInstance.lastOperation(lastOpTaskId).then((out) => {
        expect(out.state).to.eql('in progress');
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.description).to.eql(`Create deployment deployment-${guid} is still in progress`);
      });
    });
    it('should invoke last operation: op succeeded', () => {
      removeCachedTaskSpy.returns(Promise.resolve());
      finalizeSpy.returns(Promise.resolve());
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'done'
      }));
      return directorInstance.lastOperation(lastOpTaskId).then((out) => {
        expect(out.state).to.eql('succeeded');
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.description).to.include(`Create deployment deployment-${guid} succeeded`);
        expect(removeCachedTaskSpy.calledOnce).to.eql(true);
      });
    });
  });
});