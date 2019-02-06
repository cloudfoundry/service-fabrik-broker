'use strict';

const _ = require('lodash');
const Agent = require('../../data-access-layer/service-agent');
const eventmesh = require('../../data-access-layer/eventmesh');
const BaseDirectorService = require('../BaseDirectorService');
const utils = require('../../common/utils');
const cf = require('../../data-access-layer/cf');
const retry = utils.retry;
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const Promise = require('bluebird');
const backupStore = require('../../data-access-layer/iaas').backupStore;
const cloudProvider = require('../../data-access-layer/iaas').cloudProvider;
const config = require('../../common/config');
const logger = require('../../common/logger');
const bosh = require('../../data-access-layer/bosh');
const catalog = require('../common/models/catalog');

class BoshRestoreService extends BaseDirectorService {
  constructor(plan) {
    super(plan);
    this.plan = plan;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
    this.cloudProvider = cloudProvider;
    this.director = bosh.director;
  }

  async startRestore(opts) {
    try {
      logger.debug('Starting restore with options:', opts);
      const args = opts.arguments;
      const backupMetadata = _.get(args, 'backup');
      const deploymentName = await this.findDeploymentNameByInstanceId(opts.instance_guid);

      const backup = {
        guid: args.backup_guid,
        timeStamp: args.time_stamp,
        type: _.get(backupMetadata, 'type'),
        secret: _.get(backupMetadata, 'secret'),
        snapshotId: _.get(backupMetadata, 'snapshotId')
      };

      const data = _
        .chain(opts)
        .pick('service_id', 'plan_id', 'instance_guid', 'username')
        .assign({
          operation: 'restore',
          backup_guid: backup.guid,
          time_stamp: backup.timeStamp,
          state: 'processing',
          started_at: new Date().toISOString(),
          finished_at: null,
          tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid
        })
        .value();
        const service = catalog.getService(service_id);
        
        const instanceGroups = _.get(service, 'restore_operation.instance_group'); 
        let persistentDiskInfo = await this.director.getPersistentDisks(deploymentName, instanceGroups);

        //Get disk metadata of old disks
        for (let i = 0;i < persistentDiskInfo.length; i++) {
          let diskCid = persistentDiskInfo[i].disk_cid;
          let az = persistentDiskInfo[i].az;
          persistentDiskInfo[i].getDiskMetadataPromise = this.cloudProvider.getDiskMetadata(diskCid, az);
        }

        for (let i = 0;i < persistentDiskInfo.length; i++) {
          persistentDiskInfo[i].oldDiskInfo = await persistentDiskInfo[i].getDiskMetadataPromise;
          _.unset(persistentDiskInfo[i], 'getDiskMetadataPromise');
        }

        const optionsData = _
          .assign({ 
            restoreMetadata: {
              timeStamp: args.time_stamp,
              filePath: _.get(service, 'restore_operation.filesystem_path'), 
              snapshotId: _.get(backupMetadata, 'snapshotId'),
              deploymentName: deploymentName,
              deploymentInstancesInfo: persistentDiskInfo,
              snapshotId: _.get(backupMetadata, 'snapshotId'),
              baseBackupErrand: {
                name: _.get(service, 'restore_operation.errands.base_backup_restore.name'),
                instances: _.get(service, 'restore_operation.errands.base_backup_restore.instances')
              },
              pointInTimeErrand: {
                name: _.get(service, 'restore_operation.errands.point_in_time.name'),
                instances: _.get(service, 'restore_operation.errands.point_in_time.instances')
              },
              postStartErrand: {
                name: _.get(service, 'restore_operation.errands.post_start.name'),
                instances: _.get(service, 'restore_operation.errands.post_start.instances')
              }
            },
            statesResults: {}
          });
        //TODO:create/update the restoreFile
        //update resource state to bosh_stop along with needed information
        return eventmesh.apiServerClient.patchResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
          resourceId: opts.restore_guid,
          options: optionsData,
          status: {
            'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`,
            'response': data
          }
        });
    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: opts.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }

  async processState(changeObjectBody) {
    const currentState = changeObjectBody.status.state;
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    switch (currentState) {
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`:
        return this.processBoshStop(changedOptions);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`:
        return this.processCreateDisk(changedOptions);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`:
        return this.processAttachDisk(changedOptions);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`:
        return this.processPutFile(changedOptions);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_RUN_ERRANDS`:
        return this.processRunErrands(changedOptions);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`:
        return this.processBoshStart(changedOptions);
    }
  }

  //TODO: check whether stopped deployment can again be stopped [poll for task from resource options > stop > poll]
  async processBoshStop(resourceOptions) {
    try {
      //1. Get deployment name from resource
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');

      //2. Stop the bosh deployment and poll for the result
      const taskId  = await this.director.stopDeployment(deploymentName);
      const taskResult = await this.director.pollTaskStatusTillComplete(taskId);
      //3. Update the resource with next step
      let stateResult = _.assign({
        statesResults: {
          'bosh_stop': {
            taskId: taskId,
            taskResult: taskResult
          }
        }
      });
      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: stateResult,
        status: {
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`
        }
      });
    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }
//TODO: add logging to find out the failure location 
//TODO: Store the logs in restorefile or not?
  async processCreateDisk(resourceOptions) {
    try {
      //1. get snapshot id from backup metadata
      const snapshotId = _.get(resourceOptions, 'restoreMetadata.snapshotId');
      let deploymentInstancesInfo = _.cloneDeep(_.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo')); 
      //2. create persistent disks from snapshot
      for (let i = 0; i< deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];

        let promise = this.cloudProvider.createDiskFromSnapshot(snapshotId, instance.az, {type: instance.oldDiskInfo.type});
        _.set(instance, 'createDiskPromise', promise);
      }

      //3. Await for all the disk creations to complete
      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        instance.newDiskInfo = await instance.createDiskPromise;
        _.unset(instance, 'createDiskPromise');
      }
      //TODO: add information for stateResults field also
      //4. Update the resource with deploymentInstancesInfo and next state 
      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: {
          restoreMetadata: {
            deploymentInstancesInfo: deploymentInstancesInfo
          }
        },
        status: {
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`
        }
      });
    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }

  async processAttachDisk(resourceOptions) {
    try { 
      //1. Get new disk CID from resource state
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      let deploymentInstancesInfo = _.cloneDeep(_.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo'));

      //2. attach disk to all the given instances
      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        let taskId = await this.director.createDiskAttachment(deploymentName, instance.newDiskInfo.volumeId, 
          instance.job_name, instance.id);
        _.set(instance, 'attachDiskTaskId', taskId);
        let pollingPromise = this.director.pollTaskStatusTillComplete(taskId); //TODO: determine other polling parameters
        _.set(instance, 'attachDiskPollingPromise', pollingPromise);
      };

      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        instance.attachDiskTaskResult = await instance.attachDiskPollingPromise;
        _.unset(instance, 'attachDiskPollingPromise');
      };
      //TODO: add information for stateResults field also
      //3. Update the resource with deploymentInstanceInfo and next state
      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: {
          restoreMetadata: {
            deploymentInstancesInfo: deploymentInstancesInfo
          }
        },
        status: {
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`
        }
      });
    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }

  async processPutFile(resourceOptions) {
    try {
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      let deploymentInstancesInfo = _.cloneDeep(_.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo'));

      //TODO: finalize command for PITR and non-PITR case
      const filePath;
      const timeStamp;
      const cmd = `
      rm -rf ${service.restore_operation.filesystem_path}
      touch ${service.restore_operation.filesystem_path}
      echo ${JSON.stringify(resourceOptions)} > ${service.restore_operation.filesystem_path}
      sync
      `;
      //TODO: add retries
      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        instance.sshPromise = this.director.runSsh(deploymentName, instance.job_name, instance.id, cmd);
      }

      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        instance.sshResult = await instance.sshPromise;
        _.unset(instance, 'sshPromise');
      }

      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: {
          restoreMetadata: {
            deploymentInstancesInfo: deploymentInstancesInfo
          }
        },
        status: {
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_RUN_ERRANDS`
        }
      });

    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }
  //TODO: Handle the task id already present scenario. Also patch the task id immediately
  async processRunErrands(resourceOptions) {
    try {
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      const errandName = _.get(resourceOptions, 'restoreMetadata.pre-warming-errand-name');
      let deploymentInstancesInfo = _.cloneDeep(_.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo')); 
      const instancesForErrands = _.map(deploymentInstancesInfo, instance => {
        return {
          'group': instance.job_name,
          'id': instance.id
        };
      });
      const taskIdForErrand = await this.director.runDeploymentErrand(deploymentName, errandName, instancesForErrands);
      //update resource with taskID
      let taskResult = await this.director.pollTaskStatusTillComplete(taskIdForErrand);
      //handle the success/failuer/retries etc
      let stateResult = _.assign({
        statesResults: {
          'run_errands': {
            taskId: taskIdForErrand,
            taskResult: taskResult
          }
        }
      });
      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: stateResult,
        status: {
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`
        }
      });
    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }
//TODO: Handle the task id already present scenario. Also patch the task id immediately
  async processBoshStart(resourceOptions) {
    try {
      //1. Get deployment name from resource
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');

      //2. Stop the bosh deployment and poll for the result
      const taskId  = await this.director.startDeployment(deploymentName);
      const taskResult = await this.director.pollTaskStatusTillComplete(taskId);
      //3. Update the resource with next step
      let stateResult = _.assign({
        statesResults: {
          'bosh_start': {
            taskId: taskId,
            taskResult: taskResult
          }
        }
      });

      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: stateResult,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      });
    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }

 //TODO: Handle the task id already present scenario. Also patch the task id immediately 
  async processPostStart(resourceOptions) {
    try {
      const service = catalog.getService(_.get(resourceOptions,'service_id'));
    } catch (err) {
      logger.error(`Error occurred: ${err}`);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      }); 
    }
  }
  static createService(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }

}
module.exports = BoshRestoreService;