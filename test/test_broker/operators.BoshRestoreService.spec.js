'use strict';

const _ = require('lodash');
const catalog = require('../../common/models/catalog');
const BoshRestoreService = require('../../operators/bosh-restore-operator/BoshRestoreService');
const CONST = require('../../common/constants');
const cloudProvider = require('../../data-access-layer/iaas').cloudProvider;
const bosh = require('../../data-access-layer/bosh');
const eventmesh = require('../../data-access-layer/eventmesh');
const errors = require('../../common/errors');
const backupStore = require('../../data-access-layer/iaas').backupStore;

describe('operators', function () {
  describe('BoshRestoreService', function () {
    let plan;
    const planId = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const restoreGuid = '2ed8d561-9eb5-11e8-a55f-784f43900dff';
    const deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const spaceGuid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const serviceId = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const instanceId = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const backupGuid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const snapshotId = 'snap-0698d2ab282e2a597';
    const fileSystemPath = '/var/vcap/store/restore/args.json';
    const instanceGroup = ['blueprint'];
    const baseBackupErrandName = 'errand_simulation';
    describe('#startRestore', function () {
      let sandbox, findDeploymentNameByInstanceIdStub, getServiceStub, getPersistentDisksStub, getDiskMetadataStub;
      let restoreOptions = {
        'plan_id': planId,
        'service_id': serviceId,
        'context': {
          'organization_guid': '33915d88-6002-4e83-b154-9ec2075e1435',
          'platform': 'cloudfoundry',
          'space_guid': spaceGuid
        },
        'restore_guid': restoreGuid,
        'instance_guid': instanceId,
        'arguments': {
          'backup': {
            'type': 'online',
            'secret': 'Bd+hF4fB4RCjqVNt',
            'snapshotId': snapshotId,
            'started_at': '2019-02-08T10:46:16.652Z',
            'finished_at': '2019-02-08T10:48:17.198Z'
          },
          'backup_guid': backupGuid,
          'space_guid': spaceGuid,
          'context': {
            'organization_guid': '33915d88-6002-4e83-b154-9ec2075e1435',
            'platform': 'cloudfoundry',
            'space_guid': spaceGuid
          },
          'plan_id': planId
        },
        'username': 'admin_service-fabrik'
      };
      let getPersistentDisksInfo = [{
          'job_name': 'blueprint',
          'id': 'id1',
          'disk_cid': 'vol1',
          'az': 'az1'
        },
        {
          'job_name': 'blueprint',
          'id': 'id2',
          'disk_cid': 'vol2',
          'az': 'az2'
        }
      ];
      let serviceInfo = {
        restore_operation: {
          type: 'defaultboshrestore',
          filesystem_path: fileSystemPath,
          instance_group: instanceGroup,
          errands: {
            base_backup_restore: {
              name: baseBackupErrandName,
              instances: 'all'
            }
          }
        }
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        findDeploymentNameByInstanceIdStub = sandbox.stub(BoshRestoreService.prototype, 'findDeploymentNameByInstanceId');
        findDeploymentNameByInstanceIdStub.withArgs(instanceId).returns(Promise.resolve(deploymentName));
        getServiceStub = sandbox.stub(catalog, 'getService');
        getServiceStub.withArgs(serviceId).callsFake(() => serviceInfo);
        getPersistentDisksStub = sandbox.stub(bosh.director, 'getPersistentDisks');
        getPersistentDisksStub.withArgs(deploymentName, instanceGroup).resolves(getPersistentDisksInfo);
        getDiskMetadataStub = sandbox.stub(cloudProvider, 'getDiskMetadata');
        getDiskMetadataStub.resolves({
          'volumeId': 'volNew',
          'size': 1
        });
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should fetch and patch the required data', function () {
        let restoreResource = {
          spec: {
            options: JSON.stringify(restoreOptions)
          }
        };
        let getRestoreFileStub = sandbox.stub(backupStore, 'getRestoreFile').resolves();
        let putFileStub = sandbox.stub(backupStore, 'putFile').resolves();
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE, restoreGuid, restoreResource);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE, restoreGuid);
        return BoshRestoreService.createService(plan)
          .then(rs => rs.startRestore(restoreOptions))
          .then(() => {
            expect(findDeploymentNameByInstanceIdStub.callCount).to.eql(1);
            expect(getServiceStub.callCount).to.eql(1);
            expect(getPersistentDisksStub.callCount).to.eql(1);
            expect(getDiskMetadataStub.callCount).to.eql(getPersistentDisksInfo.length);
            expect(getRestoreFileStub.callCount).to.eql(1);
            expect(putFileStub.callCount).to.eql(1);
            mocks.verify();
          });
      });

    });

    describe('#processState', function () {
      let sandbox;
      let stubs = [];
      let functions = ['processBoshStop', 'processCreateDisk', 'processAttachDisk', 'processPutFile',
        'processRunErrands', 'processBoshStart', 'processPostStart'
      ];
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        _.forEach(functions, (fn) => {
          stubs.push(sandbox.stub(BoshRestoreService.prototype, fn).resolves());
        });
      });

      afterEach(() => {
        sandbox.restore();
      });
      it('should call the appropriate method for valid states', () => {
        const RESTORE_STATES = [
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_RUN_ERRANDS`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`
        ];
        let restoreResource = {
          spec: {
            options: JSON.stringify({
              dummyOptions: 'dummyOptions'
            })
          }
        };
        return BoshRestoreService.createService(plan)
          .then(rs => {
            return Promise.map(RESTORE_STATES, (state) => {
              _.set(restoreResource, 'status.state', state);
              return rs.processState(restoreResource);
            });
          })
          .then(() => {
            _.forEach(stubs, (stub) => {
              expect(stub.callCount).to.eql(1);
            });
          });
      });

      it('should throw error for invalid state', () => {
        let restoreResource = {
          spec: {
            options: JSON.stringify({
              dummyOptions: 'dummyOptions'
            })
          }
        };
        _.set(restoreResource, 'status.state', 'invalid-state');
        let patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
        let getRestoreFileStub = sandbox.stub(backupStore, 'getRestoreFile').resolves();
        let patchRestoreFileStub = sandbox.stub(backupStore, 'patchRestoreFile').resolves();
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processState(restoreResource))
          .then(() => {
            expect(patchResourceStub.callCount).to.eql(1);
            expect(getRestoreFileStub.callCount).to.eql(1);
            expect(patchRestoreFileStub.callCount).to.eql(1);
          });
      });

      it('should handle error condition in child calls', () => {
        let restoreResource = {
          spec: {
            options: JSON.stringify({
              dummyOptions: 'dummyOptions'
            })
          }
        };
        _.set(restoreResource, 'status.state', `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`);
        let patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
        stubs[0].restore();
        let processBoshStopStub = sandbox.stub(BoshRestoreService.prototype, 'processBoshStop').rejects('some error');
        let getRestoreFileStub = sandbox.stub(backupStore, 'getRestoreFile').resolves();
        let patchRestoreFileStub = sandbox.stub(backupStore, 'patchRestoreFile').resolves();
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processState(restoreResource))
          .then(() => {
            expect(patchResourceStub.callCount).to.eql(1);
            expect(processBoshStopStub.callCount).to.eql(1);
            expect(getRestoreFileStub.callCount).to.eql(1);
            expect(patchRestoreFileStub.callCount).to.eql(1);
          });  
      });
    });

    describe('#processBoshStop', function () {
      let sandbox;
      let stopDeploymentStub, patchResourceStub, pollTaskStatusTillCompleteStub;
      let restoreMetadata = {
        'deploymentName': deploymentName
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        stopDeploymentStub = sandbox.stub(bosh.director, 'stopDeployment');
        pollTaskStatusTillCompleteStub = sandbox.stub(bosh.director, 'pollTaskStatusTillComplete');
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
      });
      afterEach(() => {
        sandbox.restore();
      });

      it('should stop the deployment and update result correctly in ApiServere', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        const taskId = 'taskId';
        stopDeploymentStub.withArgs(deploymentName).resolves(taskId);
        patchResourceStub.resolves();
        pollTaskStatusTillCompleteStub.withArgs(taskId).resolves({
          state: 'done'
        });
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processBoshStop(restoreOptions))
          .then(() => {
            expect(stopDeploymentStub.callCount).to.eql(1);
            expect(patchResourceStub.callCount).to.eql(2);
            expect(pollTaskStatusTillCompleteStub.callCount).to.eql(1);
            expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql(taskId);
            expect(patchResourceStub.firstCall.args[0].options.stateResults.boshStop.taskId).to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.boshStop.taskId).to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.boshStop.taskResult.state).to.eql('done');
          });
      });

      it('should handle the case of old taskId present', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        _.set(restoreOptions, 'restoreMetadata.stateResults.boshStop.taskId', 'oldTaskId');
        const taskId = 'taskId';
        stopDeploymentStub.withArgs(deploymentName).resolves(taskId);
        patchResourceStub.resolves();
        pollTaskStatusTillCompleteStub.withArgs('oldTaskId').resolves({
          state: 'done'
        });
        pollTaskStatusTillCompleteStub.withArgs(taskId).resolves({
          state: 'done'
        });
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processBoshStop(restoreOptions))
          .then(() => {
            expect(stopDeploymentStub.callCount).to.eql(1);
            expect(patchResourceStub.callCount).to.eql(2);
            expect(pollTaskStatusTillCompleteStub.callCount).to.eql(2);
            expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql('oldTaskId');
            expect(pollTaskStatusTillCompleteStub.secondCall.args[0]).to.eql(taskId);
            expect(patchResourceStub.firstCall.args[0].options.stateResults.boshStop.taskId).to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.boshStop.taskId).to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.boshStop.taskResult.state).to.eql('done');
          });
      });

    });

    describe('#processCreateDisk', function () {
      let sandbox;
      let createDiskFromSnapshotStub, patchResourceStub;
      let restoreMetadata = {
        'deploymentName': deploymentName,
        'snapshotId': snapshotId,
        'deploymentInstancesInfo': [{
            'id': 'id-1',
            'az': 'us-east-1a',
            'oldDiskInfo': {
              'type': 'dummyType'
            }
          },
          {
            'id': 'id-2',
            'az': 'us-east-1a',
            'oldDiskInfo': {
              'type': 'dummyType'
            }
          }
        ]
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        createDiskFromSnapshotStub = sandbox.stub(cloudProvider, 'createDiskFromSnapshot');
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
      });
      afterEach(() => {
        sandbox.restore();
      });

      it('should create disks in parallel and update the resource on ApiServer', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        createDiskFromSnapshotStub.withArgs(snapshotId, 'us-east-1a', {
            type: 'dummyType'
          })
          .onFirstCall().resolves({
            'volumeId': 'vol-new-1'
          });
        createDiskFromSnapshotStub.withArgs(snapshotId, 'us-east-1a', {
            type: 'dummyType'
          })
          .onSecondCall().resolves({
            'volumeId': 'vol-new-2'
          });
        patchResourceStub.resolves();
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processCreateDisk(restoreOptions))
          .then(() => {
            expect(createDiskFromSnapshotStub.callCount).to.eql(restoreMetadata.deploymentInstancesInfo.length);
            expect(patchResourceStub.callCount).to.eql(1);
            expect(patchResourceStub.firstCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].newDiskInfo.volumeId)
              .to.eql('vol-new-1');
            expect(patchResourceStub.firstCall.args[0].options.restoreMetadata.deploymentInstancesInfo[1].newDiskInfo.volumeId)
              .to.eql('vol-new-2');
          });
      });
    });

    describe('#processAttachDisk', function () {
      let sandbox;
      let createDiskAttachmentStub, pollTaskStatusTillCompleteStub, patchResourceStub;
      let restoreMetadata;
      beforeEach(() => {
        restoreMetadata = {
          'deploymentName': deploymentName,
          'deploymentInstancesInfo': [{
              'id': 'id-1',
              'job_name': 'blueprint',
              'newDiskInfo': {
                'volumeId': 'vol-new-1'
              }
            },
            {
              'id': 'id-2',
              'job_name': 'blueprint',
              'newDiskInfo': {
                'volumeId': 'vol-new-2'
              }
            }
          ]
        };
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
        pollTaskStatusTillCompleteStub = sandbox.stub(bosh.director, 'pollTaskStatusTillComplete');
        createDiskAttachmentStub = sandbox.stub(bosh.director, 'createDiskAttachment');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('should create disk attachment in parallel and update the result in ApiServer resource', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        patchResourceStub.resolves();
        const task_1 = 'task-1';
        const task_2 = 'task-2';
        createDiskAttachmentStub.withArgs(deploymentName, restoreMetadata.deploymentInstancesInfo[0].newDiskInfo.volumeId,
            restoreMetadata.deploymentInstancesInfo[0].job_name, restoreMetadata.deploymentInstancesInfo[0].id)
          .resolves(task_1);
        createDiskAttachmentStub.withArgs(deploymentName, restoreMetadata.deploymentInstancesInfo[1].newDiskInfo.volumeId,
            restoreMetadata.deploymentInstancesInfo[1].job_name, restoreMetadata.deploymentInstancesInfo[1].id)
          .resolves(task_2);
        pollTaskStatusTillCompleteStub.withArgs(task_1).resolves({
          state: 'done'
        });
        pollTaskStatusTillCompleteStub.withArgs(task_2).resolves({
          state: 'done'
        });
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processAttachDisk(restoreOptions))
          .then(() => {
            expect(createDiskAttachmentStub.callCount).to.eql(restoreMetadata.deploymentInstancesInfo.length);
            expect(pollTaskStatusTillCompleteStub.callCount).to.eql(restoreMetadata.deploymentInstancesInfo.length);
            expect(patchResourceStub.callCount).to.eql(2);
            expect(patchResourceStub.firstCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskId)
              .to.eql(task_1);
            expect(patchResourceStub.firstCall.args[0].options.restoreMetadata.deploymentInstancesInfo[1].attachDiskTaskId)
              .to.eql(task_2);

            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskId)
              .to.eql(task_1);
            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskResult.state)
              .to.eql('done');
            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[1].attachDiskTaskId)
              .to.eql(task_2);
            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskResult.state)
              .to.eql('done');
          });

      });

      it('should handle the old task id already present case', () => {
        restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskId = 'task-old';
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        patchResourceStub.resolves();
        const task_2 = 'task-2';
        createDiskAttachmentStub.withArgs(deploymentName, restoreMetadata.deploymentInstancesInfo[1].newDiskInfo.volumeId,
            restoreMetadata.deploymentInstancesInfo[1].job_name, restoreMetadata.deploymentInstancesInfo[1].id)
          .resolves(task_2);
        pollTaskStatusTillCompleteStub.withArgs('task-old').resolves({
          state: 'done'
        });
        pollTaskStatusTillCompleteStub.withArgs(task_2).resolves({
          state: 'done'
        });
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processAttachDisk(restoreOptions))
          .then(() => {
            console.log(createDiskAttachmentStub.callCount);
            expect(createDiskAttachmentStub.callCount).to.eql(restoreMetadata.deploymentInstancesInfo.length - 1);
            expect(pollTaskStatusTillCompleteStub.callCount).to.eql(restoreMetadata.deploymentInstancesInfo.length);
            expect(patchResourceStub.callCount).to.eql(2);
            expect(patchResourceStub.firstCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskId)
              .to.eql('task-old');
            expect(patchResourceStub.firstCall.args[0].options.restoreMetadata.deploymentInstancesInfo[1].attachDiskTaskId)
              .to.eql(task_2);

            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskId)
              .to.eql('task-old');
            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskResult.state)
              .to.eql('done');
            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[1].attachDiskTaskId)
              .to.eql(task_2);
            expect(patchResourceStub.secondCall.args[0].options.restoreMetadata.deploymentInstancesInfo[0].attachDiskTaskResult.state)
              .to.eql('done');
          });

      });
    });

    describe('#processPutFile', function () {
      let sandbox;
      let runSshStub, patchResourceStub, getServiceStub;
      let restoreMetadata = {
        'deploymentName': deploymentName,
        'deploymentInstancesInfo': [{
            job_name: 'blueprint',
            id: 'id-1'
          },
          {
            job_name: 'blueprint',
            id: 'id-2'
          }
        ],
        'arguments': {
          time_stamp: 'dummyTimestamp',
          backup: {
            type: 'online',
            secret: 'secret',
            snapshotId: snapshotId,
            started_at: 'ts-1',
            finished_at: 'ts-2'
          },
          backup_guid: 'dummyBackupGuid'
        }
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
        runSshStub = sandbox.stub(bosh.director, 'runSsh');
        getServiceStub = sandbox.stub(catalog, 'getService');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('should use ssh to create a file in all instances', () => {
        let serviceInfo = {
          restore_operation: {
            filesystem_path: fileSystemPath
          }
        };
        getServiceStub.withArgs(serviceId).callsFake(() => serviceInfo);
        let restoreOptions = {
          restoreMetadata: restoreMetadata,
          service_id: serviceId
        };
        patchResourceStub.resolves();
        runSshStub.resolves({
          'code': 0,
          'stdout': '',
          'stderr': ''
        });
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processPutFile(restoreOptions))
          .then(() => {
            expect(getServiceStub.callCount).to.eql(1);
            expect(runSshStub.callCount).to.eql(restoreMetadata.deploymentInstancesInfo.length);
            expect(patchResourceStub.callCount).to.eql(1);
            let sshArgs = runSshStub.getCalls();
            for (let i = 0; i < sshArgs.length; i++) {
              let args = sshArgs[i].args;
              expect(args[0]).to.eql(deploymentName);
              expect(args[1]).to.eql(restoreOptions.restoreMetadata.deploymentInstancesInfo[i].job_name);
              expect(args[2]).to.eql(restoreOptions.restoreMetadata.deploymentInstancesInfo[i].id);
            }
          });
      });
    });

    describe('#getInstancesForErrands', function () {
      it('should return appropriate instances in correct format based on instanceOption', () => {
        let deploymentInstancesInfo = [{
            job_name: 'blueprint',
            id: 'id-1'
          },
          {
            job_name: 'blueprint',
            id: 'id-2'
          }
        ];
        plan = catalog.getPlan(planId);
        return BoshRestoreService.createService(plan)
          .then(rs => {
            let allInstances = rs.getInstancesForErrands(deploymentInstancesInfo, 'all');
            for (let i = 0; i < allInstances.length; i++) {
              expect(allInstances[i].group).to.eql(deploymentInstancesInfo[i].job_name);
              expect(allInstances[i].id).to.eql(deploymentInstancesInfo[i].id);
            }
            let anyInstance = rs.getInstancesForErrands(deploymentInstancesInfo, 'any');
            expect(anyInstance[0].group).to.eql(deploymentInstancesInfo[0].job_name);
            expect(anyInstance[0].id).to.eql(deploymentInstancesInfo[0].id);

            let secondInstance = rs.getInstancesForErrands(deploymentInstancesInfo, '1');
            expect(secondInstance[0].group).to.eql(deploymentInstancesInfo[1].job_name);
            expect(secondInstance[0].id).to.eql(deploymentInstancesInfo[1].id);

          });
      });
    });

    describe('#runErrand', function () {
      let sandbox;
      let runDeploymentErrandStub, pollTaskStatusTillCompleteStub, patchResourceStub;
      let restoreMetadata = {
        deploymentName: deploymentName,
        'baseBackupErrand': {
          'name': 'errand_simulation',
          'instances': 'all'
        },
        'deploymentInstancesInfo': [{
            job_name: 'blueprint',
            id: 'id-1'
          },
          {
            job_name: 'blueprint',
            id: 'id-2'
          }
        ],
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
        pollTaskStatusTillCompleteStub = sandbox.stub(bosh.director, 'pollTaskStatusTillComplete');
        runDeploymentErrandStub = sandbox.stub(bosh.director, 'runDeploymentErrand');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('should carryout specified errand on deployment and update the result on ApiServer', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata,
          service_id: serviceId
        };
        const taskId = 'taskId';
        pollTaskStatusTillCompleteStub.withArgs(taskId).resolves({
          state: 'done'
        });
        runDeploymentErrandStub.resolves(taskId);
        patchResourceStub.resolves();
        return BoshRestoreService.createService(plan)
          .then(rs => rs.runErrand(restoreOptions, 'baseBackupErrand'))
          .then(() => {
            expect(pollTaskStatusTillCompleteStub.callCount).to.eql(1);
            expect(runDeploymentErrandStub.callCount).to.eql(1);
            expect(patchResourceStub.callCount).to.eql(2);
            let runErrandsArgs = runDeploymentErrandStub.firstCall.args;
            expect(runErrandsArgs[0]).to.eql(deploymentName);
            expect(runErrandsArgs[1]).to.eql(restoreMetadata.baseBackupErrand.name);
            expect(patchResourceStub.firstCall.args[0].options.stateResults.errands.baseBackupErrand.taskId)
              .to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.errands.baseBackupErrand.taskId)
              .to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.errands.baseBackupErrand.taskResult.state)
              .to.eql('done');
          });
      });
      it('should throw assertion error for invalid errand type', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata,
          service_id: serviceId
        };
        return BoshRestoreService.createService(plan)
          .then(rs => rs.runErrand(restoreOptions, 'invalidErrandType'))
          .catch(err => {
            expect(err.message).to.eql(' Errand type invalidErrandType is invalid.');
          });
      });
      it('should not trigger errand if not found in service catalog', () => {
        let tempRestoreData = _.cloneDeep(restoreMetadata);
        _.unset(tempRestoreData, 'baseBackupErrand');
        let restoreOptions = {
          restoreMetadata: tempRestoreData,
          service_id: serviceId
        };
        return BoshRestoreService.createService(plan)
          .then(rs => rs.runErrand(restoreOptions, 'baseBackupErrand'))
          .then(() => {
            expect(pollTaskStatusTillCompleteStub.callCount).to.eql(0);
            expect(runDeploymentErrandStub.callCount).to.eql(0);
            expect(patchResourceStub.callCount).to.eql(0);
          });
      });
    });

    describe('#processRunErrands', function () {
      let sandbox;
      let patchResourceStub, runErrandStub;
      let restoreMetadata = {
        deploymentName: deploymentName,
        timeStamp: undefined
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
        runErrandStub = sandbox.stub(BoshRestoreService.prototype, 'runErrand');
      });
      afterEach(() => {
        sandbox.restore();
      });

      it('should trigger pitr errand only if timestamp is present in arguments', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        patchResourceStub.resolves();
        runErrandStub.resolves();
        let rsObj;
        return BoshRestoreService.createService(plan)
          .tap(rs => rsObj = rs)
          .then(() => rsObj.processRunErrands(restoreOptions))
          .then(() => {
            expect(runErrandStub.callCount).to.eql(1);
            expect(runErrandStub.firstCall.args[1]).to.eql('baseBackupErrand');
            runErrandStub.reset();
            restoreOptions.restoreMetadata.timeStamp = 'some_timestamp';
          })
          .then(() => rsObj.processRunErrands(restoreOptions))
          .then(() => {
            expect(runErrandStub.callCount).to.eql(2);
            expect(runErrandStub.firstCall.args[1]).to.eql('baseBackupErrand');
            expect(runErrandStub.secondCall.args[1]).to.eql('pointInTimeErrand');

          });
      });
    });

    describe('#processBoshStart', function () {
      let sandbox;
      let startDeploymentStub, patchResourceStub, pollTaskStatusTillCompleteStub;
      let restoreMetadata = {
        'deploymentName': deploymentName
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        startDeploymentStub = sandbox.stub(bosh.director, 'startDeployment');
        pollTaskStatusTillCompleteStub = sandbox.stub(bosh.director, 'pollTaskStatusTillComplete');
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('should start the deployment and update the resource on ApiServer', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        const taskId = 'taskId';
        startDeploymentStub.withArgs(deploymentName).resolves(taskId);
        patchResourceStub.resolves();
        pollTaskStatusTillCompleteStub.withArgs(taskId).resolves({
          state: 'done'
        });
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processBoshStart(restoreOptions))
          .then(() => {
            expect(startDeploymentStub.callCount).to.eql(1);
            expect(patchResourceStub.callCount).to.eql(2);
            expect(pollTaskStatusTillCompleteStub.callCount).to.eql(1);
            expect(patchResourceStub.firstCall.args[0].options.stateResults.boshStart.taskId).to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.boshStart.taskId).to.eql(taskId);
            expect(patchResourceStub.secondCall.args[0].options.stateResults.boshStart.taskResult.state).to.eql('done');
          });
      });
    });

    describe('#processPostStart', function () {
      let sandbox;
      let patchResourceStub, runErrandStub;
      let restoreMetadata = {
        deploymentName: deploymentName
      };
      beforeEach(() => {
        plan = catalog.getPlan(planId);
        sandbox = sinon.createSandbox();
        patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
        runErrandStub = sandbox.stub(BoshRestoreService.prototype, 'runErrand');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('should call runErrand for postStartErrand and update ApiServer resource', () => {
        let restoreOptions = {
          restoreMetadata: restoreMetadata
        };
        let getRestoreFileStub = sandbox.stub(backupStore, 'getRestoreFile').resolves();
        let patchRestoreFileStub = sandbox.stub(backupStore, 'patchRestoreFile').resolves();
        patchResourceStub.resolves();
        runErrandStub.resolves();
        return BoshRestoreService.createService(plan)
          .then(rs => rs.processPostStart(restoreOptions))
          .then(() => {
            expect(runErrandStub.callCount).to.eql(1);
            expect(patchResourceStub.callCount).to.eql(1);
            expect(getRestoreFileStub.callCount).to.eql(1);
            expect(patchRestoreFileStub.callCount).to.eql(1);
            expect(runErrandStub.firstCall.args[1]).to.eql('postStartErrand');
          });
      });
    });

  });
});