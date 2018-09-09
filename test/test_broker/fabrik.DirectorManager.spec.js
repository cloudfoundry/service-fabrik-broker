'use strict';

const _ = require('lodash');
const yaml = require('js-yaml');
const catalog = require('../../common/models').catalog;
const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const DeploymentAttemptRejected = errors.DeploymentAttemptRejected;

var used_guid = '4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9';
var deployment_name = `service-fabrik-0021-${used_guid}`;
var boshStub = {
  NetworkSegmentIndex: {
    adjust: function (num) {
      return num;
    },
    findFreeIndex: function () {
      return 2;
    }
  },
  director: {
    getDeploymentNames: function () {
      return Promise.resolve([deployment_name]);
    },
    getDeploymentNameForInstanceId: function () {
      return Promise.resolve([deployment_name]);
    }
  }
};

describe('fabrik', function () {
  describe('DirectorManager- without rate limits', function () {
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const xsmall_plan_id = plan_id;
    const small_plan_id = 'bc158c9a-7934-401e-94ab-057082a5073e';
    let return_value;
    let manager;
    var DirectorManager = proxyquire('../../broker/lib/fabrik/DirectorManager', {
      '../../../data-access-layer/bosh': boshStub,
    });

    before(function () {
      manager = new DirectorManager(catalog.getPlan(plan_id));
    });
    afterEach(function () {
      mocks.reset();
    });
    describe('#findNetworkSegmentIndex', function () {
      it('should append guid and network segment index to deployment name', function () {
        manager.findNetworkSegmentIndex(used_guid).then(res => expect(res).to.eql(21));
      });
    });
    describe('#isRestorePossible', function () {
      it('should return false when plan not in restore_predecessors', function () {
        // restore not possible from small to xsmall
        manager = new DirectorManager(catalog.getPlan(xsmall_plan_id));
        manager.update_predecessors = [];
        return_value = expect(manager.isRestorePossible(small_plan_id)).to.be.false;
      });
      it('should return true when plan not in restore_predecessors', function () {
        // restore possible from xsmall to small
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        manager.update_predecessors = [xsmall_plan_id];
        return_value = expect(manager.isRestorePossible(xsmall_plan_id)).to.be.true;
      });
    });
    describe('#restorePredecessors', function () {
      it('should return update_predecessors if restore_predecessors is not defined', function () {
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        manager.update_predecessors = [xsmall_plan_id];
        expect(manager.restorePredecessors).to.eql(manager.update_predecessors);
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
        manager = new DirectorManager(catalog.getPlan(rabbit_plan_id));
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql({});
          });
      });
      it('should return empty response if actions are not provided', function () {
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        let temp_actions = manager.service.actions;
        manager.service.actions = '';
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            manager.service.actions = temp_actions;
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
        manager = new DirectorManager(catalog.getPlan(xsmall_plan_id));
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql({});
            mocks.verify();
          });
      });
    });
    describe('#configureAddOns', function () {
      it('should update manifest with addons', function () {
        const plan = _.cloneDeep(catalog.getPlan(plan_id));
        const directorManager = new DirectorManager(plan);
        const updatedTemplate = directorManager.template + '\n' +
          'addons: \n' +
          '  - name: service-addon \n' +
          '    jobs: \n' +
          '    - name: service-addon \n' +
          '      release: service-release';
        directorManager.plan.manager.settings.template = Buffer.from(updatedTemplate).toString('base64');
        expect(directorManager.plan.id).to.eql(plan_id);
        expect(directorManager.getDeploymentName(used_guid, '90')).to.eql(`service-fabrik-90-${used_guid}`);
        const manifest = yaml.safeLoad(directorManager.generateManifest(`service-fabrik-90-${used_guid}`, {}));
        expect(manifest.addons.length).to.equal(2);
        expect(manifest.releases.length).to.equal(2);
      });
      it('should not update manifest with addons with parameter skip_addons set to true', function () {
        const directorManager = new DirectorManager(catalog.getPlan(plan_id));
        expect(directorManager.plan.id).to.eql(plan_id);
        expect(directorManager.getDeploymentName(used_guid, '90')).to.eql(`service-fabrik-90-${used_guid}`);
        const manifest = yaml.safeLoad(directorManager.generateManifest(`service-fabrik-90-${used_guid}`, {
          skip_addons: true
        }));
        expect(manifest.addons).to.equal(undefined);
        expect(manifest.releases.length).to.equal(1);
      });
    });
  });
  describe('DirectorManager- with rate limits', function () {
    var configStub = {
      'enable_bosh_rate_limit': true
    };
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const task_id = 'task_id';
    const deploymentName = 'deploymentName';
    let manager;
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
      deploymentSpy.returns(Promise.resolve(task_id));
      var DirectorManagerSub = proxyquire('../../broker/lib/fabrik/DirectorManager', {
        '../../../common/config': configStub,
        '../../../data-access-layer/bosh': boshStub
      });
      manager = new DirectorManagerSub(catalog.getPlan(plan_id));
      manager.director = {
        'getDirectorForOperation': directorOpSpy,
        'getCurrentTasks': currentTasksSpy,
        'getDeploymentNames': getDirectorDeploymentsSpy
      };
      manager._createOrUpdateDeployment = deploymentSpy;
      manager.getInstanceGuid = getInstanceGuidSpy;
    });

    afterEach(function () {
      sandbox.restore();
      mocks.reset();
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
          return manager.createOrUpdateDeployment(deploymentName, params)
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
          return manager.createOrUpdateDeployment(deploymentName, params)
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
          return manager.createOrUpdateDeployment(deploymentName, params)
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
          return manager.createOrUpdateDeployment(deploymentName)
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
          return manager.createOrUpdateDeployment(deploymentName, params)
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
          scheduled: true
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
          return manager.createOrUpdateDeployment(deploymentName, params)
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
          return manager.createOrUpdateDeployment(deploymentName, params)
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
          return manager.createOrUpdateDeployment(deploymentName, params)
            .catch(DeploymentAttemptRejected, () => {
              expect(storeSpy.notCalled).to.eql(true);
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
        return manager.executePolicy(false, 'create', 'deploymentName')
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
        return manager.executePolicy(true, 'update', 'deploymentName', false, true)
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
        return manager.executePolicy(true, 'update', 'deploymentName', false, true)
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
        return manager.executePolicy(false, 'update', 'deploymentName', false, true)
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
        return manager.executePolicy(false, 'update', 'deploymentName', false, true)
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
        return manager.executePolicy(false, 'update', 'deploymentName', false, true)
          .then(out => {
            expect(out.shouldRunNow).to.eql(false);
          });
      });
    });
  });
});