'use strict';

const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const _ = require('lodash');
const catalog = require('../../common/models/catalog');
const yaml = require('js-yaml');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const assert = require('assert');
const DeploymentAttemptRejected = errors.DeploymentAttemptRejected;
const DirectorService = require('../../managers/bosh-manager/DirectorService');

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
    scheduled: true
  },
  context: {}
};

var used_guid = '4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9';
var used_guid2 = '6a6e7c34-d37c-4fc0-94e6-7a3bc8030bb9';
var deployment_name = `service-fabrik-0021-${used_guid}`;

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
        expect(codSpy.args[0]).to.eql([`service-fabrik-0000-${guid}`, expectedParams]);
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
        expect(codSpy.args[0]).to.eql([`service-fabrik-0000-${guid}`, expectedParams]);
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
    let directorService;
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
        let expectedParams = _.cloneDeep(params);
        _.set(expectedParams, 'parameters', _.assign(_.cloneDeep(params.parameters), {
          scheduled: true
        }));
        expect(out.cached).to.eql(undefined);
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(_.assign(_.cloneDeep(params.parameters), {
          scheduled: true
        }));
        expect(out.context).to.eql(params.context);
        expect(codSpy.args[0]).to.eql([`service-fabrik-0000-${guid}`, expectedParams]);
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
  describe('DirectorService- without rate limits', function () {
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const small_plan_id = 'bc158c9a-7934-401e-94ab-057082a5073e';
    let directorService;

    before(function () {
      directorService = new DirectorService(guid, catalog.getPlan(plan_id));
    });
    afterEach(function () {
      mocks.reset();
    });
    describe('#cleanupOperation', function () {
      it('should not clean up if bosh rate limit is disabled', function () {
        return directorService.cleanupOperation(deployment_name);
      });
    });
    describe('#findNetworkSegmentIndex', function () {
      it('should append guid and network segment index to deployment name', function () {
        directorService.findNetworkSegmentIndex(used_guid).then(res => expect(res).to.eql(21));
      });
    });

    describe('#executeActions', function () {
      before(function () {
        return mocks.setup([]);
      });

      afterEach(function () {
        mocks.reset();
      });
      const rabbit_plan_id = 'b715f834-2048-11e7-a560-080027afc1e6';
      const context = {
        deployment_name: 'my-deployment'
      };
      it('should return empty response if no actions are defined', function () {
        const service = new DirectorService(guid, catalog.getPlan(rabbit_plan_id));
        return service.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql({});
          });
      });
      it('should return empty response if actions are not provided', function () {
        const dService = new DirectorService(guid, catalog.getPlan(small_plan_id));
        let temp_actions = dService.service.actions;
        dService.service.actions = '';
        return dService.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            dService.service.actions = temp_actions;
            expect(actionResponse).to.eql({});
          });
      });
      it('should return correct action response', function () {
        const expectedRequestBody = {
          phase: 'PreCreate',
          actions: ['Blueprint', 'ReserveIps'],
          context: {
            deployment_name: 'my-deployment'
          }
        };
        mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
        return directorService.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql({});
            mocks.verify();
          });
      });
    });
    describe('#configureAddOns', function () {
      it('should update manifest with addons', function () {
        const plan = _.cloneDeep(catalog.getPlan(plan_id));
        const directorService = new DirectorService(guid, plan);
        const updatedTemplate = directorService.template + '\n' +
          'addons: \n' +
          '  - name: service-addon \n' +
          '    jobs: \n' +
          '    - name: service-addon \n' +
          '      release: service-release';
        directorService.plan.manager.settings.template = Buffer.from(updatedTemplate).toString('base64');
        expect(directorService.plan.id).to.eql(plan_id);
        const manifest = yaml.safeLoad(directorService.generateManifest(`service-fabrik-90-${used_guid}`, {}));
        expect(manifest.addons.length).to.equal(2);
        expect(manifest.releases.length).to.equal(2);
      });
      it('should not update manifest with addons with parameter skip_addons set to true', function () {
        const directorService = new DirectorService(guid, _.cloneDeep(catalog.getPlan(plan_id)));
        expect(directorService.plan.id).to.eql(plan_id);
        const manifest = yaml.safeLoad(directorService.generateManifest(`service-fabrik-90-${used_guid}`, {
          skip_addons: true
        }));
        expect(manifest.addons).to.equal(undefined);
        expect(manifest.releases.length).to.equal(1);
      });
    });
  });
  describe('DirectorService- with rate limits', function () {
    var configStub = {
      'enable_bosh_rate_limit': true
    };
    const task_id = 'task_id';
    const instance_id = 'guid';
    const deploymentName = 'deploymentName';
    let service;
    let sandbox, directorOpSpy, currentTasksSpy, containsInstanceSpy;
    let deleteDeploymentSpy, getBoshTaskSpy, containsDeploymentSpy, deploymentSpy, storeSpy, storeBoshSpy;
    let getCachedDeploymentsSpy, getDirectorDeploymentsSpy, deleteTaskSpy, getInstanceGuidSpy;

    beforeEach(function () {
      sandbox = sinon.sandbox.create();
      directorOpSpy = sandbox.stub();
      currentTasksSpy = sandbox.stub();
      containsInstanceSpy = sandbox.stub();
      getBoshTaskSpy = sandbox.stub();
      containsDeploymentSpy = sandbox.stub();
      deploymentSpy = sandbox.stub();
      deleteDeploymentSpy = sandbox.stub();
      storeSpy = sandbox.stub();
      storeBoshSpy = sandbox.stub();
      getCachedDeploymentsSpy = sandbox.stub();
      getDirectorDeploymentsSpy = sandbox.stub();
      getInstanceGuidSpy = sandbox.stub();
      deleteTaskSpy = sandbox.stub();
      var boshStub = {
        BoshOperationQueue: {
          containsServiceInstance: containsInstanceSpy,
          getBoshTask: getBoshTaskSpy,
          containsDeployment: containsDeploymentSpy,
          saveDeployment: storeSpy,
          deleteDeploymentFromCache: deleteDeploymentSpy,
          saveBoshTask: storeBoshSpy,
          getDeploymentNames: getCachedDeploymentsSpy,
          deleteBoshTask: deleteTaskSpy
        },
        NetworkSegmentIndex: {
          adjust: function (num) {
            return num;
          },
          findFreeIndex: function () {
            return 2;
          }
        }
      };
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan = catalog.getPlan(plan_id);
      deploymentSpy.returns(Promise.resolve(task_id));
      var DirectorServiceSub = proxyquire('../../managers/bosh-manager/DirectorService', {
        '../../common/config': configStub,
        '../../data-access-layer/bosh': boshStub
      });
      service = new DirectorServiceSub(guid, plan);
      service.director = {
        'getDirectorForOperation': directorOpSpy,
        'getCurrentTasks': currentTasksSpy,
        'getDeploymentNames': getDirectorDeploymentsSpy
      };
      service._createOrUpdateDeployment = deploymentSpy;
      service.getInstanceGuid = getInstanceGuidSpy;
    });

    afterEach(function () {
      sandbox.restore();
      mocks.reset();
    });
    describe('#acquireNetworkSegmentIndex', () => {
      it('should return network segment index when there are deployment names in etcd', () => {
        getCachedDeploymentsSpy.returns([`service-fabrik-90-${used_guid2}`]);
        getDirectorDeploymentsSpy.returns([`service-fabrik-90-${used_guid}`]);
        return service.acquireNetworkSegmentIndex('guid')
          .then(index => {
            expect(index).to.eql(2);
          });
      });
    });

    describe('#cleanupOperation', function () {
      it('should clean up an existing operation properly', () => {
        getInstanceGuidSpy.returns(used_guid);
        deleteTaskSpy.returns(Promise.resolve(true));
        deleteDeploymentSpy.returns(Promise.resolve(true));
        return service.cleanupOperation(deploymentName)
          .then(() => {
            expect(deleteTaskSpy.calledOnce).to.eql(true);
            assert(deleteTaskSpy.calledWith(used_guid));
            expect(deleteDeploymentSpy.calledOnce).to.eql(true);
            assert(deleteDeploymentSpy.calledWith(deploymentName));
          });
      });
      it('should not clean up an existing operation in case of repeated errors', function () {
        this.timeout(20000);
        getInstanceGuidSpy.returns(used_guid);
        deleteTaskSpy.returns(Promise.reject(new Error('delete_task_error')));
        deleteDeploymentSpy.returns(Promise.resolve(true));
        return service.cleanupOperation(deploymentName).catch(err => {
          expect(err.code).to.eql('ETIMEDOUT');
          expect(deleteTaskSpy.callCount).to.eql(5);
          assert(deleteTaskSpy.calledWith(used_guid));
          expect(deleteDeploymentSpy.callCount).to.eql(1);
          assert(deleteDeploymentSpy.calledWith(deploymentName));
        });
      });
    });

    describe('#createOrUpdateDeployment', () => {
      let params = {
        previous_values: {}
      };
      describe('user operations', () => {
        it('should run operation from etcd when policy applied, slots available and in cache previously', () => {
          storeSpy.returns(Promise.resolve());
          storeBoshSpy.returns(Promise.resolve());
          containsDeploymentSpy.returns(Promise.resolve(true));
          deleteDeploymentSpy.returns(Promise.resolve());
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              user: {
                update: {
                  max_workers: 3
                }
              }
            }
          }));
          currentTasksSpy.returns(Promise.resolve({
            total: 5,
            update: 2
          }));
          return service.createOrUpdateDeployment(deploymentName, params)
            .then(out => {
              expect(out.cached).to.eql(true);
              expect(out.task_id).to.eql(task_id);
              expect(storeSpy.calledOnce).to.eql(false);
              expect(deleteDeploymentSpy.calledOnce).to.eql(true);
              expect(containsDeploymentSpy.calledOnce).to.eql(true);
              expect(storeBoshSpy.calledOnce).to.eql(true);
            });
        });
        it('should store operation in etcd when policy applied but no slots available and in cache previously', () => {
          storeSpy.returns(Promise.resolve());
          containsDeploymentSpy.returns(Promise.resolve(true));
          deleteDeploymentSpy.returns(Promise.resolve());
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              user: {
                update: {
                  max_workers: 3
                }
              }
            }
          }));
          currentTasksSpy.returns(Promise.resolve({
            total: 5,
            update: 3
          }));
          return service.createOrUpdateDeployment(deploymentName, params)
            .then(out => {
              expect(out.cached).to.eql(true);
              expect(out.task_id).to.eql(undefined);
              expect(storeSpy.calledOnce).to.eql(true);
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(containsDeploymentSpy.notCalled).to.eql(true);
            });
        });
        it('should store operation in etcd when policy applied but no slots available and not in cache previously', () => {
          storeSpy.returns(Promise.resolve());
          containsDeploymentSpy.returns(Promise.resolve(false));
          deleteDeploymentSpy.returns(Promise.resolve());
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              user: {
                update: {
                  max_workers: 3
                }
              }
            }
          }));
          currentTasksSpy.returns(Promise.resolve({
            total: 5,
            update: 3
          }));
          return service.createOrUpdateDeployment(deploymentName, params)
            .then(out => {
              expect(out.cached).to.eql(true);
              expect(out.task_id).to.eql(undefined);
              expect(storeSpy.calledOnce).to.eql(true);
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(containsDeploymentSpy.notCalled).to.eql(true);
            });
        });
        it('should store operation in etcd when bosh is down', () => {
          storeSpy.returns(Promise.resolve());
          deleteDeploymentSpy.returns(Promise.resolve());
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              user: {
                update: {
                  max_workers: 3
                }
              }
            }
          }));
          currentTasksSpy.returns(Promise.reject(new Error('Bosh unavailable')));
          return service.createOrUpdateDeployment(deploymentName)
            .then(out => {
              expect(out.cached).to.eql(true);
              expect(storeSpy.calledOnce).to.eql(true);
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(deploymentSpy.notCalled).to.eql(true);
            });
        });
      });
      describe('mongodb operation', () => {
        let params = {
          scheduled: true,
          parameters: {
            '_runImmediately': true
          }
        };
        it('should proceed with mongo update without rate limiting', () => {
          currentTasksSpy.returns(Promise.resolve({
            total: 5,
            scheduled: 2
          }));
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              user: {
                update: {
                  max_workers: 3
                }
              },
              scheduled: {
                update: {
                  max_workers: 3
                }
              }
            }
          }));
          return service.createOrUpdateDeployment(deploymentName, params)
            .then(out => {
              expect(out.cached).to.eql(false);
              expect(out.task_id).to.eql(task_id);
              expect(storeSpy.notCalled).to.eql(true);
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(deploymentSpy.calledOnce).to.eql(true);
            });
        });
      });
      describe('scheduled operations', () => {
        let params = {
          parameters: {
            scheduled: true
          }
        };
        it('should not store operation in etcd and throw error when bosh is down', () => {
          storeSpy.returns(Promise.resolve());
          deleteDeploymentSpy.returns(Promise.resolve());
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              user: {
                update: {
                  max_workers: 3
                }
              }
            }
          }));
          currentTasksSpy.returns(Promise.reject(new Error('Bosh unavailable')));
          return service.createOrUpdateDeployment(deploymentName, params)
            .catch(DeploymentAttemptRejected, () => {
              expect(storeSpy.notCalled).to.eql(true);
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(deploymentSpy.notCalled).to.eql(true);
            });
        });
        it('should run scheduled operation successfully', () => {
          containsDeploymentSpy.returns(Promise.reject(new Error('etcd connect error')));
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              scheduled: {
                max_workers: 3
              }
            }
          }));
          currentTasksSpy.returns(Promise.resolve({
            total: 5,
            scheduled: 2
          }));
          return service.createOrUpdateDeployment(deploymentName, params)
            .then(out => {
              expect(out.task_id).to.eql(task_id);
              expect(out.cached).to.eql(false);
              expect(deploymentSpy.callCount).to.eql(1);
              expect(containsDeploymentSpy.notCalled).to.eql(true);
              expect(storeSpy.notCalled).to.eql(true);
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
            });
        });
        it('should reject deployment when policy is applied + slots unavailable', () => {
          containsDeploymentSpy.returns(Promise.resolve(false));
          directorOpSpy.returns(Promise.resolve({
            max_workers: 6,
            policies: {
              scheduled: {
                max_workers: 3
              }
            }
          }));
          currentTasksSpy.returns(Promise.resolve({
            total: 5,
            scheduled: 3
          }));
          return service.createOrUpdateDeployment(deploymentName, params)
            .catch(DeploymentAttemptRejected, () => {
              expect(storeSpy.notCalled).to.eql(true);
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(deploymentSpy.notCalled).to.eql(true);
            });
        });
      });
    });
    describe('#getCurrentOperationState', () => {
      it('should return operation state based on inputs- cached + task_id', () => {
        getBoshTaskSpy.returns(Promise.resolve(task_id));
        containsInstanceSpy.returns(Promise.resolve(true));

        return service.getCurrentOperationState(instance_id)
          .then(output => {
            expect(output.cached).to.eql(true);
            expect(output.task_id).to.eql(task_id);
          });
      });
      it('should return operation state based on inputs- not cached + no task_id', () => {
        getBoshTaskSpy.returns(Promise.resolve(null));
        containsInstanceSpy.returns(Promise.resolve(false));

        return service.getCurrentOperationState(instance_id)
          .then(output => {
            expect(output.cached).to.eql(false);
            expect(output.task_id).to.eql(null);
          });
      });
    });
    describe('#executePolicy', () => {
      it('should not run now when all slots exhausted in bosh', () => {
        directorOpSpy.returns(Promise.resolve({
          max_workers: 6
        }));
        currentTasksSpy.returns(Promise.resolve({
          total: 6
        }));
        return service.executePolicy(false, 'create', 'deploymentName')
          .then(out => {
            expect(out.shouldRunNow).to.eql(false);
          });
      });
      it('should not run now when slots for scheduled ops are exhausted in bosh', () => {
        directorOpSpy.returns(Promise.resolve({
          max_workers: 6,
          policies: {
            scheduled: {
              max_workers: 3
            }
          }
        }));
        currentTasksSpy.returns(Promise.resolve({
          total: 5,
          scheduled: 3
        }));
        return service.executePolicy(true, 'update', 'deploymentName', false, true)
          .then(out => {
            expect(out.shouldRunNow).to.eql(false);
          });
      });
      it('should run now when slots for scheduled ops are available in bosh', () => {
        directorOpSpy.returns(Promise.resolve({
          max_workers: 6,
          policies: {
            scheduled: {
              max_workers: 3
            }
          }
        }));
        currentTasksSpy.returns(Promise.resolve({
          total: 5,
          scheduled: 2
        }));
        return service.executePolicy(true, 'update', 'deploymentName', false, true)
          .then(out => {
            expect(out.shouldRunNow).to.eql(true);
          });
      });
      it('should not run now when slots for user ops are exhausted in bosh', () => {
        directorOpSpy.returns(Promise.resolve({
          max_workers: 6,
          policies: {
            user: {
              update: {
                max_workers: 3
              }
            }
          }
        }));
        currentTasksSpy.returns(Promise.resolve({
          total: 5,
          update: 3
        }));
        return service.executePolicy(false, 'update', 'deploymentName', false, true)
          .then(out => {
            expect(out.shouldRunNow).to.eql(false);
          });
      });
      it('should run now when slots for user ops are available in bosh', () => {
        directorOpSpy.returns(Promise.resolve({
          max_workers: 6,
          policies: {
            user: {
              update: {
                max_workers: 3
              }
            }
          }
        }));
        currentTasksSpy.returns(Promise.resolve({
          total: 5,
          update: 2
        }));
        return service.executePolicy(false, 'update', 'deploymentName', false, true)
          .then(out => {
            expect(out.shouldRunNow).to.eql(true);
          });
      });
      it('should not run now when bosh returns an error', () => {
        directorOpSpy.returns(Promise.resolve({
          max_workers: 6,
          policies: {
            user: {
              update: {
                max_workers: 3
              }
            }
          }
        }));
        currentTasksSpy.returns(Promise.reject(new Error('Bosh unavailable')));
        return service.executePolicy(false, 'update', 'deploymentName', false, true)
          .then(out => {
            expect(out.shouldRunNow).to.eql(false);
          });
      });
    });
  });
});