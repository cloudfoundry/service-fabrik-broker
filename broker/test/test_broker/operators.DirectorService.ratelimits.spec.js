'use strict';

const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const _ = require('lodash');
const { catalog } = require('@sf/models');
const yaml = require('js-yaml');
const {
  CONST,
  errors: {
    DeploymentAttemptRejected,
    DirectorServiceUnavailable,
    ServiceInstanceAlreadyExists,
    ServiceInstanceNotFound
  }
} = require('@sf/common-utils');
const DirectorService = require('../../applications/operators/src/bosh-operator/DirectorService');
const CfPlatformManager = require('../../core/platform-managers/src/CfPlatformManager');

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

let used_guid = '4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9';
let used_guid2 = '6a6e7c34-d37c-4fc0-94e6-7a3bc8030bb9';
const index = mocks.director.networkSegmentIndex;

const expectedGetDeploymentResponse = {
  metadata: {
    name: used_guid2,
    labels: {
      label1: 'label1',
      label2: 'label2',
      last_backup_defaultbackups: 'backup1'
    },
    creationTimestamp: '2018-09-26T20:45:28Z'
  },
  spec: {
    options: JSON.stringify({
      opt1: 'opt1',
      opt2: 'opt2'
    }),
    instanceId: used_guid2
  },
  status: {
    state: 'create',
    response: JSON.stringify({
      resp: 'resp',
      deployment_name: `service-fabrik-90-${used_guid2}`
    })
  }
};

describe('service', () => {
  describe('DirectorService - with ratelimits', function () {
    let configStub = {
      'enable_bosh_rate_limit': true
    };

    let lastOpWithoutTaskId;
    let DirectorServiceSub;
    let directorService;
    let sandbox;
    let initializeSpy, codSpy, finalizeSpy, getTaskSpy;
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const plan = catalog.getPlan(plan_id);

    beforeEach(() => {
      lastOpWithoutTaskId = {
        type: 'create'
      };
      sandbox = sinon.createSandbox();
      initializeSpy = sandbox.stub();
      initializeSpy.returns(Promise.resolve());
      finalizeSpy = sandbox.stub();
      getTaskSpy = sandbox.stub();
      codSpy = sandbox.stub();
      codSpy.returns(Promise.resolve({
        task_id: undefined
      }));
      DirectorServiceSub = proxyquire('../../applications/operators/src/bosh-operator/DirectorService', {
        '@sf/app-config': configStub
      });
      directorService = new DirectorServiceSub(plan, guid);
      directorService.networkSegmentIndex = index;
      directorService.createOrUpdateDeployment = codSpy;
      directorService.getTask = getTaskSpy;
      directorService.initialize = initializeSpy;
      directorService.finalize = finalizeSpy;
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should create with rate limits', () => {
      return directorService.create(params).then(out => {
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(`service-fabrik-0021-${guid}`);
        expect(codSpy.callCount).to.eql(1);
      });
    });

    it('should update with rate limits', () => {
      return directorService.update(params).then(out => {
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(`service-fabrik-0021-${guid}`);
        expect(codSpy.callCount).to.eql(1);
      });
    });

    it('should create with rate limits - bosh resilience - staggered', () => {
      initializeSpy.returns(Promise.reject(new DirectorServiceUnavailable()));
      directorService.networkSegmentIndex = undefined;
      return directorService.create(params).then(out => {
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(undefined);
        expect(codSpy.callCount).to.eql(0);
      });
    });

    it('should update with rate limits - bosh resilience - staggered', () => {
      initializeSpy.returns(Promise.reject(new DirectorServiceUnavailable()));
      directorService.networkSegmentIndex = undefined;
      return directorService.update(params).then(out => {
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(undefined);
        expect(codSpy.callCount).to.eql(0);
      });
    });

    it('should update with rate limits - internal operation [runs immediately]', () => {
      let iparams = _.cloneDeep(internal_params);
      iparams.parameters._runImmediately = true;
      return directorService.update(iparams).then(out => {
        let expectedParams = iparams;
        expectedParams.scheduled = true;
        expectedParams._runImmediately = true;

        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(iparams.parameters);
        expect(out.context).to.eql(iparams.context);
        expect(codSpy.args[0]).to.eql([`service-fabrik-0021-${guid}`, expectedParams]);
      });
    });
    it('should update with rate limits - internal operation [staggers]', () => {
      let iparams = _.cloneDeep(internal_params);
      iparams.parameters._runImmediately = false;
      return directorService.update(iparams).then(out => {
        let expectedParams = iparams;
        expectedParams.scheduled = true;
        expectedParams._runImmediately = false;

        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(iparams.parameters);
        expect(out.context).to.eql(iparams.context);
        expect(codSpy.args[0]).to.eql([`service-fabrik-0021-${guid}`, expectedParams]);
      });
    });
    it('should invoke last operation: op in progress - cached', () => {
      return directorService.lastOperation(lastOpWithoutTaskId).then(out => {
        expect(out.state).to.eql('in progress');
        expect(out.task_id).to.eql(undefined);
        expect(out.description).to.eql('Create deployment is still in progress');
        expect(getTaskSpy.notCalled).to.eql(true);
      });
    });
    it('should invoke last operation: op in progress- task available', () => {
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'in progress'
      }));
      return directorService.lastOperation(lastOpWithoutTaskId).then(out => {
        expect(out.state).to.eql('in progress');
        expect(out.task_id).to.eql(undefined);
        expect(out.description).to.eql('Create deployment is still in progress');
      });
    });
    it('should invoke last operation: op done- task succeeded', () => {
      finalizeSpy.returns(Promise.resolve());
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'done'
      }));
      return directorService.lastOperation(_.assign(_.cloneDeep(lastOpWithoutTaskId), {
        task_id: task_id
      })).then(out => {
        expect(out.state).to.eql('succeeded');
        expect(out.task_id).to.eql(task_id);
        expect(out.description).to.include(`Create deployment deployment-${guid} succeeded`);
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
    let initializeSpy, codSpy, deleteDeploymentSpy, getTaskSpy, finalizeSpy;
    let lastOpTaskId;

    beforeEach(() => {
      lastOpTaskId = {
        task_id: task_id,
        type: 'create'
      };
      sandbox = sinon.createSandbox();
      initializeSpy = sandbox.stub();
      initializeSpy.returns(Promise.resolve());
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan = catalog.getPlan(plan_id);
      finalizeSpy = sandbox.stub();
      codSpy = sandbox.stub();
      codSpy.returns(Promise.resolve({
        task_id: task_id
      }));
      deleteDeploymentSpy = sandbox.stub();
      deleteDeploymentSpy.returns(Promise.resolve(task_id));
      getTaskSpy = sandbox.stub();
      DirectorServiceSub = proxyquire('../../applications/operators/src/bosh-operator/DirectorService', {
        '@sf/app-config': configStub
      });
      directorService = new DirectorServiceSub(plan, guid);
      directorService.networkSegmentIndex = index;
      directorService.createOrUpdateDeployment = codSpy;
      directorService.deleteDeployment = deleteDeploymentSpy;
      directorService.getTask = getTaskSpy;
      directorService.initialize = initializeSpy;
      directorService.finalize = finalizeSpy;
    });

    afterEach(() => {
      lastOpTaskId = null;
      sandbox.restore();
    });

    it('should create without rate limits', () => {
      return directorService.create(params).then(out => {
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(`service-fabrik-0021-${guid}`);
        expect(codSpy.callCount).to.eql(1);
      });
    });

    it('should update without rate limits', () => {
      return directorService.update(params).then(out => {
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(`service-fabrik-0021-${guid}`);
        expect(codSpy.callCount).to.eql(1);
      });
    });

    it('should delete without rate limits', () => {
      directorService.platformManager = new CfPlatformManager('cloudfoundry');
      return directorService.delete(params).then(out => {
        expect(out.task_id).to.eql(task_id);
        expect(out.context).to.eql({
          platform: 'cloudfoundry'
        });
        expect(out.deployment_name).to.eql(`service-fabrik-0021-${guid}`);
        expect(deleteDeploymentSpy.callCount).to.eql(1);
      });
    });

    it('should create without rate limits - bosh resilience - staggered', () => {
      initializeSpy.returns(Promise.reject(new DirectorServiceUnavailable()));
      directorService.networkSegmentIndex = undefined;
      return directorService.create(params).then(out => {
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(undefined);
        expect(codSpy.callCount).to.eql(0);
      });
    });

    it('should update without rate limits - bosh resilience - staggered', () => {
      initializeSpy.returns(Promise.reject(new DirectorServiceUnavailable()));
      directorService.networkSegmentIndex = undefined;
      return directorService.update(params).then(out => {
        expect(out.task_id).to.eql(undefined);
        expect(out.parameters).to.eql(params.parameters);
        expect(out.context).to.eql(params.context);
        expect(out.deployment_name).to.eql(undefined);
        expect(codSpy.callCount).to.eql(0);
      });
    });

    it('should delete without rate limits - bosh resilience - staggered', () => {
      directorService.platformManager = new CfPlatformManager('cloudfoundry');
      initializeSpy.returns(Promise.reject(new DirectorServiceUnavailable()));
      directorService.networkSegmentIndex = undefined;
      return directorService.delete(params).then(out => {
        expect(out.task_id).to.eql(undefined);
        expect(out.context).to.eql({
          platform: 'cloudfoundry'
        });
        expect(out.deployment_name).to.eql(undefined);
        expect(deleteDeploymentSpy.callCount).to.eql(0);
      });
    });

    it('should not create without rate limits - fails due to exception', () => {
      initializeSpy.returns(Promise.reject(new ServiceInstanceAlreadyExists()));
      directorService.networkSegmentIndex = undefined;
      return directorService.create(params)
        .catch(err => {
          expect(err instanceof ServiceInstanceAlreadyExists).to.eql(true);
          expect(codSpy.callCount).to.eql(0);
        });
    });

    it('should not update without rate limits - fails due to exception', () => {
      initializeSpy.returns(Promise.reject(new ServiceInstanceNotFound()));
      directorService.networkSegmentIndex = undefined;
      return directorService.update(params)
        .catch(err => {
          expect(err instanceof ServiceInstanceNotFound).to.eql(true);
          expect(codSpy.callCount).to.eql(0);
        });
    });

    it('should update without rate limits - internal operation', () => {
      return directorService.update(internal_params).then(out => {
        let expectedParams = _.cloneDeep(params);
        _.set(expectedParams, 'parameters', _.assign(_.cloneDeep(params.parameters), {
          scheduled: true
        }));
        expect(out.task_id).to.eql(task_id);
        expect(out.parameters).to.eql(_.assign(_.cloneDeep(params.parameters), {
          scheduled: true
        }));
        expect(out.context).to.eql(params.context);
        expect(codSpy.args[0]).to.eql([`service-fabrik-0021-${guid}`, expectedParams]);
      });
    });
    it('should invoke last operation: op in progress', () => {
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'in progress'
      }));
      return directorService.lastOperation(lastOpTaskId).then(out => {
        expect(out.state).to.eql('in progress');
        expect(out.task_id).to.eql(task_id);
        expect(out.description).to.eql(`Create deployment deployment-${guid} is still in progress`);
      });
    });
    it('should invoke last operation: op succeeded', () => {
      finalizeSpy.returns(Promise.resolve());
      getTaskSpy.returns(Promise.resolve({
        deployment: `deployment-${guid}`,
        timestamp: (new Date().getTime()) / 1000,
        state: 'done'
      }));
      return directorService.lastOperation(lastOpTaskId).then(out => {
        expect(out.state).to.eql('succeeded');
        expect(out.task_id).to.eql(task_id);
        expect(out.description).to.include(`Create deployment deployment-${guid} succeeded`);
      });
    });
  });
  describe('DirectorService- without rate limits', function () {
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const small_plan_id = 'bc158c9a-7934-401e-94ab-057082a5073e';
    let directorService;

    before(function () {
      directorService = new DirectorService(catalog.getPlan(plan_id), guid);
    });
    afterEach(function () {
      mocks.reset();
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
        const service = new DirectorService(catalog.getPlan(rabbit_plan_id), guid);
        return service.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql({});
          });
      });
      it('should return empty response if actions are not provided', function () {
        const dService = new DirectorService(catalog.getPlan(small_plan_id), guid);
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
        const directorService = new DirectorService(plan, guid);
        directorService.platformManager = new CfPlatformManager('cloudfoundry');
        const updatedTemplate = directorService.template + '\n' +
          'addons: \n' +
          '  - name: service-addon \n' +
          '    jobs: \n' +
          '    - name: service-addon \n' +
          '      release: service-release';
        directorService.plan.manager.settings.template = Buffer.from(updatedTemplate).toString('base64');
        expect(directorService.plan.id).to.eql(plan_id);
        return directorService.generateManifest(`service-fabrik-90-${used_guid}`, {})
          .then(generatedManifest => {
            const manifest = yaml.safeLoad(generatedManifest);
            expect(manifest.addons.length).to.equal(2);
            expect(manifest.releases.length).to.equal(2);
          });
      });
      it('should not update manifest with addons with parameter skip_addons set to true', function () {
        const directorService = new DirectorService(_.cloneDeep(catalog.getPlan(plan_id)), guid);
        directorService.platformManager = new CfPlatformManager('cloudfoundry');
        expect(directorService.plan.id).to.eql(plan_id);
        return directorService.generateManifest(`service-fabrik-90-${used_guid}`, {
          skip_addons: true
        }).then(generatedManifest => {
          const manifest = yaml.safeLoad(generatedManifest);
          expect(manifest.addons).to.equal(undefined);
          expect(manifest.releases.length).to.equal(1);
        });
      });
    });
  });
  describe('DirectorService- with rate limits', function () {
    let configStub = {
      'enable_bosh_rate_limit': true
    };
    const task_id = 'task_id';
    const deploymentName = 'deploymentName';
    let service;
    let sandbox, directorOpSpy, currentTasksSpy;
    let deleteDeploymentSpy, containsDeploymentSpy, deploymentSpy;
    let getDirectorDeploymentsSpy, getInstanceGuidSpy;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      directorOpSpy = sandbox.stub();
      currentTasksSpy = sandbox.stub();
      containsDeploymentSpy = sandbox.stub();
      deploymentSpy = sandbox.stub();
      deleteDeploymentSpy = sandbox.stub();
      getDirectorDeploymentsSpy = sandbox.stub();
      getInstanceGuidSpy = sandbox.stub();
      let boshStub = {
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
      let DirectorServiceSub = proxyquire('../../applications/operators/src/bosh-operator/DirectorService', {
        '@sf/app-config': configStub,
        '@sf/bosh': boshStub
      });
      service = new DirectorServiceSub(plan, guid);
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
      it('should return network segment index when there are deployment names in cache', () => {
        mocks.apiServerEventMesh.nockGetResourceListByState(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, [CONST.APISERVER.RESOURCE_STATE.WAITING], [expectedGetDeploymentResponse], 1, 200);
        getDirectorDeploymentsSpy.returns([`service-fabrik-90-${used_guid}`]);
        return service.acquireNetworkSegmentIndex('guid')
          .then(index => {
            expect(index).to.eql(2);
            mocks.verify();
          });
      });
    });

    describe('#createOrUpdateDeployment', () => {
      let params = {
        previous_values: {}
      };
      describe('user operations', () => {
        it('should run operation when policy applied, slots available and in cache previously', () => {
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
              expect(out.task_id).to.eql(task_id);
              expect(directorOpSpy.calledOnce).to.eql(true);
              expect(currentTasksSpy.calledOnce).to.eql(true);
            });
        });
        it('should cache when policy applied but no slots available', () => {
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
              expect(out.task_id).to.eql(undefined);
              expect(directorOpSpy.calledOnce).to.eql(true);
              expect(currentTasksSpy.calledOnce).to.eql(true);
            });
        });
        it('should store operation in cache when bosh is down', () => {
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
              expect(_.get(out, 'task_id')).to.be.eql(undefined);
              expect(directorOpSpy.calledOnce).to.be.eql(true);
              expect(currentTasksSpy.calledOnce).to.eql(true);
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
              expect(out.task_id).to.eql(task_id);
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
        it('should not store operation in cache and throw error when bosh is down', () => {
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
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(deploymentSpy.notCalled).to.eql(true);
            });
        });
        it('should run scheduled operation successfully', () => {
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
              expect(deploymentSpy.callCount).to.eql(1);
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
              expect(deleteDeploymentSpy.notCalled).to.eql(true);
              expect(deploymentSpy.notCalled).to.eql(true);
            });
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
