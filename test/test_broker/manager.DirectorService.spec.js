'use strict';

const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const _ = require('lodash');
const catalog = require('../../common/models/catalog');

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



describe('manager', () => {
  describe('DirectorService - with ratelimits', function () {
    let configStub = {
      'enable_bosh_rate_limit': true
    };

    let lastOpWithoutTaskId;
    let DirectorServiceSub;
    let directorService;
    let sandbox;
    let initializeSpy, codSpy, finalizeSpy, getTaskSpy, getOpStateSpy, removeCachedTaskSpy;
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const plan = catalog.getPlan(plan_id);

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
      DirectorServiceSub = proxyquire('../../managers/bosh-manager/DirectorService', {
        '../../../common/config': configStub
      });
      directorService = new DirectorServiceSub(guid, plan);
      directorService.createOrUpdateDeployment = codSpy;
      directorService.getCurrentOperationState = getOpStateSpy;
      directorService.getTask = getTaskSpy;
      directorService.cleanupOperation = removeCachedTaskSpy;
      directorService.initialize = initializeSpy;
      directorService.finalize = finalizeSpy;
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should create with rate limits', () => {
      return directorService.create(params).then(out => {
        expect(out.cached).to.eql(true);
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update with rate limits', () => {
      return directorService.update(params).then(out => {
        expect(out.cached).to.eql(true);
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update with rate limits - internal operation [runs immediately]', () => {
      let iparams = _.cloneDeep(internal_params);
      iparams.parameters._runImmediately = true;
      return directorService.update(iparams).then(out => {
        let expectedParams = iparams;
        expectedParams.scheduled = true;
        expectedParams._runImmediately = true;

        expect(out.cached).to.eql(true);
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(iparams.parameters);
        expect(out.context).to.eql(iparams.context);
        expect(codSpy.args[0]).to.eql([`service-fabrik-0000-${guid}`, expectedParams, undefined]);
      });
    });
    it('should update with rate limits - internal operation [staggers]', () => {
      let iparams = _.cloneDeep(internal_params);
      iparams.parameters._runImmediately = false;
      return directorService.update(iparams).then(out => {
        let expectedParams = iparams;
        expectedParams.scheduled = true;
        expectedParams._runImmediately = false;

        expect(out.cached).to.eql(true);
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(iparams.parameters);
        expect(out.context).to.eql(iparams.context);
        expect(codSpy.args[0]).to.eql([`service-fabrik-0000-${guid}`, expectedParams, undefined]);
      });
    });
    it('should invoke last operation: op in progress - cached', () => {
      getOpStateSpy.returns({
        cached: true
      });
      return directorService.lastOperation(lastOpWithoutTaskId).then((out) => {
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
      return directorService.lastOperation(lastOpWithoutTaskId).then((out) => {
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
      return directorService.lastOperation(lastOpWithoutTaskId).then((out) => {
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
      return directorService.lastOperation(lastOpWithoutTaskId).catch(err => {
        expect(err.message).to.eql('etcd_error');
        expect(removeCachedTaskSpy.calledOnce).to.eql(true);
      });
    });
  });
  describe('DirectorInstance- without ratelimits', () => {
    let configStub = {
      'enable_bosh_rate_limit': false
    };
    let DirectorServiceSub;
    let directorService, manager;
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
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan = catalog.getPlan(plan_id);
      finalizeSpy = sandbox.stub();
      codSpy = sandbox.stub();
      codSpy.returns(Promise.resolve({
        task_id: task_id
      }));
      getTaskSpy = sandbox.stub();
      DirectorServiceSub = proxyquire('../../managers/bosh-manager/DirectorService', {
        '../../../common/config': configStub
      });
      directorService = new DirectorServiceSub(guid, plan);
      directorService.createOrUpdateDeployment = codSpy;
      //directorService.getCurrentOperationState = getOpStateSpy;
      directorService.getTask = getTaskSpy;
      directorService.cleanupOperation = removeCachedTaskSpy;
      directorService.initialize = initializeSpy;
      directorService.finalize = finalizeSpy;
    });

    afterEach(() => {
      lastOpTaskId = null;
      sandbox.restore();
    });

    it('should create without rate limits', () => {
      return directorService.create(params).then(out => {
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update without rate limits', () => {
      return directorService.update(params).then(out => {
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
      });
    });
    it('should update without rate limits - internal operation', () => {
      return directorService.update(internal_params).then(out => {
        let expectedParams = params;
        expectedParams.scheduled = true;
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(codSpy.args[0]).to.eql([`service-fabrik-0000-${guid}`, expectedParams, undefined]);
      });
    });
    it('should invoke last operation: op in progress', () => {
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'in progress'
      }));
      return directorService.lastOperation(lastOpTaskId).then((out) => {
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
      return directorService.lastOperation(lastOpTaskId).then((out) => {
        expect(out.state).to.eql('succeeded');
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.description).to.include(`Create deployment deployment-${guid} succeeded`);
        expect(removeCachedTaskSpy.calledOnce).to.eql(true);
      });
    });
  });
});