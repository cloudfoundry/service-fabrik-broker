'use strict';

const _ = require('lodash');
const assert = require('assert');
const eventmesh = require('../../data-access-layer/eventmesh');
const BaseDirectorService = require('../BaseDirectorService');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const cloudProvider = require('../../data-access-layer/iaas').cloudProvider;
const logger = require('../../common/logger');
const bosh = require('../../data-access-layer/bosh');
const catalog = require('../../common/models/catalog');
const backupStore = require('../../data-access-layer/iaas').backupStore;
const config = require('../../common/config');

class BoshRestoreService extends BaseDirectorService {
  constructor(plan) {
    super(plan);
    this.plan = plan;
    this.cloudProvider = cloudProvider;
    this.director = bosh.director;
    this.backupStore = backupStore;
  }

  async startRestore(opts) { 
    try {
      logger.debug('Starting restore with options:', opts);
      const args = opts.arguments;
      const backupMetadata = _.get(args, 'backup');
      const deploymentName = await this.findDeploymentNameByInstanceId(opts.instance_guid); 
      const data = _
        .chain(opts)
        .pick('service_id', 'plan_id', 'instance_guid', 'username')
        .assign({
          operation: CONST.OPERATION_TYPE.RESTORE,
          backup_guid: args.backup_guid,
          time_stamp: args.time_stamp,
          state: CONST.RESTORE_OPERATION.PROCESSING,
          started_at: new Date().toISOString(),
          finished_at: null,
          tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid
        })
        .value();
      const service = catalog.getService(opts.service_id);
      const instanceGroups = _.get(service, 'restore_operation.instance_group');
      let persistentDiskInfo = await this.director.getPersistentDisks(deploymentName, instanceGroups); 
      let getDiskMetadataFn = async instance => {
        let diskCid = instance.disk_cid;
        let az = instance.az;
        instance.oldDiskInfo = await this.cloudProvider.getDiskMetadata(diskCid, az);
      };
      await Promise.all(persistentDiskInfo.map(getDiskMetadataFn)); 
      const optionsData = _
        .assign({
          restoreMetadata: {
            timeStamp: args.time_stamp,
            filePath: _.get(service, 'restore_operation.filesystem_path'),
            snapshotId: _.get(backupMetadata, 'snapshotId'),
            deploymentName: deploymentName,
            deploymentInstancesInfo: persistentDiskInfo,
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
          stateResults: {}
        });
      let restoreFileMetadata;
      try {
        restoreFileMetadata = await this.backupStore.getRestoreFile(data);
      } catch(err) {
        if (!(err instanceof errors.NotFound)) {
          throw err;
        }
      }
      await this.backupStore.putFile(_.assign(data, {
        restore_dates: _.get(restoreFileMetadata, 'restore_dates')
      }));
      return eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: opts.restore_guid,
        options: optionsData,
        status: {
          'state': `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BOSH_STOP`,
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
 
  async createPatchObject(opts, stateToUpdate) {
    const options = _.assign({
      service_id: opts.service_id,
      plan_id: opts.plan_id,
      tenant_id: opts.context ? this.getTenantGuid(opts.context) : opts.tenant_id,
      instance_guid: opts.instance_guid
    });
    const restoreFileMetadata = await this.backupStore.getRestoreFile(options);
    const lastRestoreGuid = _.get(restoreFileMetadata, 'last_restore_guid', undefined);
    if(lastRestoreGuid === opts.restore_guid) {
      return;
    }
    let restoreFinishiedAt = new Date().toISOString();
    let restoreDates = _.get(restoreFileMetadata, 'restore_dates') || {};
    let restoreDatesByState = _.get(restoreDates, stateToUpdate) || [];
    restoreDatesByState.push(restoreFinishiedAt);
    let uniqueDates = [...new Set(restoreDatesByState)]; // one more safeguard against duplication
    const patchObj = {
      last_restore_guid: opts.restore_guid,
      state: stateToUpdate,
      finished_at: restoreFinishiedAt,
      restore_dates: _.chain(restoreDates)
        .set(stateToUpdate, _.sortBy(uniqueDates))
        .value()
    };
    return patchObj;
  }

  async patchRestoreFileWithFinalResult(opts, patchObj) {
    if(_.isEmpty(patchObj)) {
      logger.info('empty patchObj passed. Not patching to file.');
      return;
    }
    const options = _.assign({
      service_id: opts.service_id,
      plan_id: opts.plan_id,
      tenant_id: opts.context ? this.getTenantGuid(opts.context) : opts.tenant_id,
      instance_guid: opts.instance_guid
    });
    return this.backupStore.patchRestoreFile(options, patchObj);
  }

  async processState(changeObjectBody) {
    let currentState, changedOptions;
    try {
      currentState = changeObjectBody.status.state;
      changedOptions = JSON.parse(changeObjectBody.spec.options);
      logger.info(`routing ${currentState} to appropriate function in service for restore ${changedOptions.restore_guid}`);
      switch (currentState) {
        case `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BOSH_STOP`:
          await this.processBoshStop(changedOptions);
          break;
        case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`:
          await this.processCreateDisk(changedOptions);
          break;
        case `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_ATTACH_DISK`:
          await this.processAttachDisk(changedOptions);
          break;
        case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`:
          await this.processPutFile(changedOptions);
          break;
        case `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BASEBACKUP_ERRAND`:
          await this.processBaseBackupErrand(changedOptions);
          break;
        case `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_PITR_ERRAND`:
            await this.processPitrErrand(changedOptions);
            break;
        case `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BOSH_START`:
          await this.processBoshStart(changedOptions);
          break;
        case `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_POST_BOSH_START_ERRAND`:
          await this.processPostStart(changedOptions);
          break;
        default:
          throw new errors.BadRequest(`Invalid state ${currentState} while bosh based restore operation.`);
      }
    } catch(err) {
      logger.error(`Error occurred in state ${currentState} for restore ${changedOptions.restore_guid}: ${err}`);
      const patchObj = await this.createPatchObject(changedOptions, 'failed');
      let patchResourceObj = {
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: changedOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED 
        }
      };
      if(!_.isEmpty(patchObj)) {
        _.set(patchResourceObj, 'status.response', patchObj);
      }
      await eventmesh.apiServerClient.patchResource(patchResourceObj);
      return this.patchRestoreFileWithFinalResult(changedOptions, patchObj);
    }
  }

  async processBoshStop(resourceOptions) { 
    const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
    let patchResourceObj = { 
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      status: {
        'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`
      }
    };
    const oldTaskId = _.get(resourceOptions, 'stateResults.boshStop.taskId', undefined);
    if (_.isEmpty(oldTaskId)) {
      const taskId = await this.director.stopDeployment(deploymentName); 
      let stateResult = _.assign({
        stateResults: {
          'boshStop': {
            taskId: taskId
          }
        }
      });
      _.set(patchResourceObj, 'options', stateResult);
    } 
    await eventmesh.apiServerClient.patchResource(patchResourceObj);
  }
  // TODO: Store the logs in restorefile or not?
  // TODO: Putting some threshold on disk creation.
  async processCreateDisk(resourceOptions) { 
    const snapshotId = _.get(resourceOptions, 'restoreMetadata.snapshotId');
    let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');

    let createDiskFn = async instance => {
      logger.info(`Triggering disk creation with snapshotId: ${snapshotId}, az: ${instance.az} and type: ${instance.oldDiskInfo.type} for instance ${instance.id}`);
      instance.newDiskInfo = await this.cloudProvider.createDiskFromSnapshot(snapshotId, instance.az, {
        type: instance.oldDiskInfo.type
      });
    };
    await Promise.all(deploymentInstancesInfo.map(createDiskFn)); 
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
        'state': `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_ATTACH_DISK`
      }
    });
  
  }

  async processAttachDisk(resourceOptions) { 
    const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
    let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');
    let createDiskAttachmentTaskFn = async instance => {
      let taskId = _.get(instance, 'attachDiskTaskId', undefined);
      if (_.isEmpty(taskId)) {
        taskId = await this.director.createDiskAttachment(deploymentName, instance.newDiskInfo.volumeId,
          instance.job_name, instance.id);
        _.set(instance, 'attachDiskTaskId', taskId);
      }
    };
    await Promise.all(deploymentInstancesInfo.map(createDiskAttachmentTaskFn)); 
    await eventmesh.apiServerClient.patchResource({ 
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
  }

  async processPutFile(resourceOptions) { 
    const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
    let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');
    const service = catalog.getService(resourceOptions.service_id);
    const backupData = _.assign({
      type: _.get(resourceOptions, 'arguments.backup.type'),
      backup_guid: _.get(resourceOptions, 'arguments.backup_guid'),
      backup_secret: _.get(resourceOptions, 'arguments.backup.secret'),
      snapshotId: _.get(resourceOptions, 'arguments.backup.snapshotId'),
      started_at: _.get(resourceOptions, 'arguments.backup.started_at'),
      finished_at: _.get(resourceOptions, 'arguments.backup.finished_at'),
      time_stamp: _.get(resourceOptions, 'arguments.time_stamp')
    });
    let stringified = JSON.stringify(backupData);
    const escaped = stringified.replace(/"/g, '\\"');
    const cmd = `
    sudo -u root rm -rf ${service.restore_operation.filesystem_path}
    sudo -u root mkdir -p $(dirname ${service.restore_operation.filesystem_path})
    sudo -u root touch ${service.restore_operation.filesystem_path}
    sudo -u root bash -c 'echo "${escaped}" > ${service.restore_operation.filesystem_path}'
    sudo -u root sync
    `;
    let sshFn = async instance => {
      instance.sshResult = await this.director.runSsh(deploymentName, instance.job_name, instance.id, cmd);
    };
    // TODO: add retries
    await Promise.all(deploymentInstancesInfo.map(sshFn)); 
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
        'state': `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BASEBACKUP_ERRAND`
      }
    });
  }

  getInstancesForErrands(deploymentInstancesInfo, instanceOption) {
    switch (instanceOption) {
      case CONST.ALL:
        return _.map(deploymentInstancesInfo, instance => {
          return {
            'group': instance.job_name,
            'id': instance.id
          };
        });
      case CONST.ANY:
        return [{
          'group': deploymentInstancesInfo[0].job_name,
          'id': deploymentInstancesInfo[0].id
        }];
      default:
        if (isNaN(instanceOption) || _.isEmpty(instanceOption)) {
          throw new errors.BadRequest(`Invalid 'instances' option: ${instanceOption}`);
        }
        let instanceIndex = parseInt(instanceOption);
        if (instanceIndex >= deploymentInstancesInfo.length || instanceIndex < 0) {
          throw new errors.BadRequest(`${instanceIndex} out of bound, number of instances: ${deploymentInstancesInfo.length}`);
        }
        return [{
          'group': deploymentInstancesInfo[instanceIndex].job_name,
          'id': deploymentInstancesInfo[instanceIndex].id
        }];
    }
  }

  async triggerErrand(resourceOptions, errandType) { 
    assert.ok(_.includes(['baseBackupErrand', 'pointInTimeErrand', 'postStartErrand'], errandType), ` Errand type ${errandType} is invalid.`);
    const oldTaskId = _.get(resourceOptions, `stateResults.errands.${errandType}.taskId`, undefined);
    if (_.isEmpty(oldTaskId)) {
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      const errandName = _.get(resourceOptions, `restoreMetadata.${errandType}.name`);
      const instanceOption = _.get(resourceOptions, `restoreMetadata.${errandType}.instances`);
      if (_.isEmpty(errandName)) {
        logger.info(`Errand ${errandType} not found in catalog for ${deploymentName}. Continuing without triggering ${errandType}.`);
        return;
      }
      let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');
      let instancesForErrands = this.getInstancesForErrands(deploymentInstancesInfo, instanceOption);
      logger.info(`Running errand ${errandName} for restore ${resourceOptions.restore_guid} on following instances: ${instancesForErrands}.`);
      const taskIdForErrand = await this.director.runDeploymentErrand(deploymentName, errandName, instancesForErrands); 
      let errands = {};
      errands[errandType] = {
        taskId: taskIdForErrand
      };
      let stateResults = _.assign({
        stateResults: {
          errands: errands
        }
      });
      await eventmesh.apiServerClient.patchResource({ 
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        options: stateResults
      });
    } else {
      logger.info(`Older task for ${errandType} exists. Waiting for task ${oldTaskId}. Won't trigger errand again.`);
    }
  }

  async processBaseBackupErrand(resourceOptions) { 
    await this.triggerErrand(resourceOptions, 'baseBackupErrand'); 
    return eventmesh.apiServerClient.patchResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      status: {
        'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BASEBACKUP_ERRAND`
      }
    });
  }

  async processPitrErrand(resourceOptions) {
    const timeStamp = _.get(resourceOptions, 'restoreMetadata.timeStamp');
    if (!_.isEmpty(timeStamp)) {
      await this.triggerErrand(resourceOptions, 'pointInTimeErrand'); 
    }
    return eventmesh.apiServerClient.patchResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      status: {
        'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PITR_ERRAND`
      }
    });
  }

  async processBoshStart(resourceOptions) { 
    const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
    const oldTaskId = _.get(resourceOptions, 'stateResults.boshStart.taskId', undefined);
    let patchResourceObj = { 
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      status: {
        'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`
      }
    }
    if (_.isEmpty(oldTaskId)) {
      const taskId = await this.director.startDeployment(deploymentName); 
      let stateResult = _.assign({
        stateResults: {
          'boshStart': {
            taskId: taskId
          }
        }
      });
      _.set(patchResourceObj, 'options', stateResult);
    } 
    await eventmesh.apiServerClient.patchResource(patchResourceObj);
  }

  async processPostStart(resourceOptions) { 
    await this.triggerErrand(resourceOptions, 'postStartErrand'); 
    return eventmesh.apiServerClient.patchResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      status: {
        'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`
      }
    });   
  }

  static createService(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }

}
module.exports = BoshRestoreService;
