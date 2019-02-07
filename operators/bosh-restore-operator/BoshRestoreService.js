'use strict';

const _ = require('lodash');
const Agent = require('../../data-access-layer/service-agent');
const assert = require('assert');
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
const catalog = require('../../common/models/catalog');

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
        const service = catalog.getService(opts.service_id);
        
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
      logger.error(`Error occurred while starting the restore: ${err}`);
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
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`:
        return this.processPostStart(changedOptions);
    }
  }

  async processBoshStop(resourceOptions) {
    try {
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      const oldTaskId = _.get(resourceOptions, 'restoreMetadata.statesResults.boshStop.taskId', undefined);
      
      if (!_.isEmpty(oldTaskId)) {
        await this.director.pollTaskStatusTillComplete(oldTaskId);
      }
      const taskId  = await this.director.stopDeployment(deploymentName);
      let stateResult = _.assign({
        statesResults: {
          'boshStop': {
            taskId: taskId
          }
        }
      });

      await eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: stateResult
      });

      const taskResult = await this.director.pollTaskStatusTillComplete(taskId);
      stateResult = {};
      stateResult = _.assign({
        statesResults: {
          'boshStop': {
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
      logger.error(`Error occurred while stopping the bosh deployment ${deploymentName}: ${err}`);
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
//TODO: Store the logs in restorefile or not?
//TODO: Putting some threshold on disk creation.
  async processCreateDisk(resourceOptions) {
    try {
      const snapshotId = _.get(resourceOptions, 'restoreMetadata.snapshotId');
      let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo'); 
      for (let i = 0; i< deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        logger.info(`Triggering disk creation with snapshotId: ${snapshotId}, az: ${instance.az} and type: ${instance.oldDiskInfo.type}`);
        let promise = this.cloudProvider.createDiskFromSnapshot(snapshotId, instance.az, {type: instance.oldDiskInfo.type});
        _.set(instance, 'createDiskPromise', promise);
      }

      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        instance.newDiskInfo = await instance.createDiskPromise;
        _.unset(instance, 'createDiskPromise');
        logger.info(`Disk creation successful for ${instance.id}. New diskId is: ${instance.newDiskInfo.volumeId}`);
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
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`
        }
      });
    } catch (err) {
      logger.error(`Error occurred while creating new disks: ${err}`);
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
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');

      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        let taskId = _.get(instance, 'attachDiskTaskId', undefined);
        if(_.isEmpty(taskId)) {
          taskId = await this.director.createDiskAttachment(deploymentName, instance.newDiskInfo.volumeId, 
            instance.job_name, instance.id);
          _.set(instance, 'attachDiskTaskId', taskId);

        }
        let pollingPromise = this.director.pollTaskStatusTillComplete(taskId);
        _.set(instance, 'attachDiskPollingPromise', pollingPromise);
      };
      //TODO: remove promise from deploymentInstancesInfo object
      await eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: {
          restoreMetadata: {
            deploymentInstancesInfo: deploymentInstancesInfo
          }
        }
      });

      for(let i = 0; i < deploymentInstancesInfo.length; i++) {
        let instance = deploymentInstancesInfo[i];
        instance.attachDiskTaskResult = await instance.attachDiskPollingPromise;
        _.unset(instance, 'attachDiskPollingPromise');
      };
      //TODO: add information for stateResults field also
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
      let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');

      const service = catalog.getService(resourceOptions.service_id);
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

  getInstancesForErrands(deploymentInstancesInfo, instanceOption) {
    switch(instanceOption) {
      case CONST.ALL:
        return _.map(deploymentInstancesInfo, instance => {
          return {
            'group': instance.job_name,
            'id': instance.id
          };
        });
      case CONST.ANY:
        return [
          {
          'group': deploymentInstancesInfo[0].job_name,
          'id': deploymentInstancesInfo[0].id
          }
        ];
      default:
        if(isNaN(instanceOption) || _.isEmpty(instanceOption)) {
          throw new BadRequest(`Invalid 'instances' option for ${errandType}: ${instanceOption}`);
        } 
        let instanceIndex = parseInt(instanceOption);
        return [
          {
          'group': deploymentInstancesInfo[instanceIndex].job_name,
          'id': deploymentInstancesInfo[instanceIndex].id
          }
        ];
    }
  }

  async runErrand(resourceOptions, errandType) {
    assert.ok(_.includes(['baseBackupErrand', 'pointInTimeErrand', 'postStartErrand'], errandType), ` Errand type ${errandType} is invalid.`);
    const oldTaskId = _.get(resourceOptions, `stateResults.errands.${errandType}.taskId`, undefined);
    if (!_.isEmpty(oldTaskId)) {
      logger.info(`Older task for ${errandType} exists. Waiting for task ${oldTaskId}. Won't trigger errand again.`);
      const taskResult = await this.director.pollTaskStatusTillComplete(oldTaskId);
      let errands = {};
      errands[errandType].taskId = oldTaskId;
      errands[errandType].taskResult = taskResult;
      let stateResults = _.assign({
        stateResults : {
          errands: errands
        }
      });
      await eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: stateResults
      });
      return;
    }

    const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
    const errandName = _.get(resourceOptions, `restoreMetadata.${errandType}.name`);
    const instanceOption = _.get(resourceOptions, `restoreMetadata.${errandType}.instances`);
    if (_.isEmpty(errandName)) {
      logger.info(`Errand ${errandType} not found in catalog for ${deploymentName}. Continuing without triggering ${errandType}.`);
      return;
    }
    let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');
    let instancesForErrands = this.getInstancesForErrands(deploymentInstancesInfo, instanceOption);
    logger.info(`Running errand ${errandName} on following instances: ${instancesForErrands}.`);
    const taskIdForErrand = await this.director.runDeploymentErrand(deploymentName, errandName, instancesForErrands);
    let errands = {};
    errands[errandType].taskId = taskIdForErrand;
    let stateResults = _.assign({
      stateResults : {
        errands: errands
      }
    });
    await eventmesh.apiServerClient.patchResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      options: stateResults
    });
    const taskResult = await this.director.pollTaskStatusTillComplete(taskIdForErrand);
    errands = {};
    stateResults = {};
    errands[errandType].taskId = taskIdForErrand;
    errands[errandType].taskResult = taskResult;
    stateResults = _.assign({
      stateResults : {
        errands: errands
      }
    });
    return eventmesh.apiServerClient.patchResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      options: stateResults
    });
  }

  async processRunErrands(resourceOptions) {
    try {
      await this.runErrand(resourceOptions, 'baseBackupErrand');
      const timeStamp = _.get(resourceOptions, 'restoreMetadata.timeStamp');
      if(!_.isEmpty(timeStamp)) {
        await this.runErrand(resourceOptions, 'pointInTimeErrand');
      }
      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`
        }
      });
    } catch (err) {
      logger.error(`Error occurred while running errands: ${err}`);
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

  async processBoshStart(resourceOptions) {
    try {
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      const oldTaskId = _.get(resourceOptions, 'restoreMetadata.statesResults.boshStart.taskId', undefined);
      
      if (!_.isEmpty(oldTaskId)) {
        await this.director.pollTaskStatusTillComplete(oldTaskId);
      }

      const taskId  = await this.director.startDeployment(deploymentName);
      let stateResult = _.assign({
        statesResults: {
          'boshStart': {
            taskId: taskId
          }
        }
      });

      await eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: stateResult
      });
      const taskResult = await this.director.pollTaskStatusTillComplete(taskId);
      stateResult = {}
      stateResult = _.assign({
        statesResults: {
          'boshStart': {
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
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`
        }
      });
    } catch (err) {
      logger.error(`Error occurred while starting the bosh deployment: ${err}`);
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

  async processPostStart(resourceOptions) {
    try {
      await this.runErrand(resourceOptions, 'postStartErrand');
      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      });
    } catch (err) {
      logger.error(`Error occurred in bosh post start: ${err}`);
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