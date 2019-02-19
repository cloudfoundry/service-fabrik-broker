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
          operation: 'restore',
          backup_guid: args.backup_guid,
          time_stamp: args.time_stamp,
          state: 'processing',
          started_at: new Date().toISOString(),
          finished_at: null,
          tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid
        })
        .value();

      const service = catalog.getService(opts.service_id);
      const instanceGroups = _.get(service, 'restore_operation.instance_group');
      let persistentDiskInfo = await this.director.getPersistentDisks(deploymentName, instanceGroups); 

      /* jshint ignore: start */
      let getDiskMetadataFn = async instance => {
        let diskCid = instance.disk_cid;
        let az = instance.az;
        instance.oldDiskInfo = await this.cloudProvider.getDiskMetadata(diskCid, az);
      };
      /* jshint ignore: end */

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

  async patchRestoreFileWithFinalResult(opts, stateToUpdate) {
    const options = _.assign({
      service_id: opts.service_id,
      plan_id: opts.plan_id,
      tenant_id: opts.context ? this.getTenantGuid(opts.context) : opts.tenant_id,
      instance_guid: opts.instance_guid
    });
    let restoreFileMetadata = await this.backupStore.getRestoreFile(options);
    let restoreFinishiedAt = new Date().toISOString();
    let restoreDates = _.get(restoreFileMetadata, 'restore_dates') || {};
    let restoreDatesByState = _.get(restoreDates, stateToUpdate) || [];
    if (_.indexOf(restoreDatesByState, restoreFinishiedAt) === -1) {
      restoreDatesByState.push(restoreFinishiedAt);
    }
    let uniqueDates = [...new Set(restoreDatesByState)];
    const patchObj = {
      state: stateToUpdate,
      finished_at: restoreFinishiedAt,
      restore_dates: _.chain(restoreDates)
        .set(stateToUpdate, _.sortBy(uniqueDates))
        .value()
    };
    return this.backupStore.patchRestoreFile(options, patchObj);
  }

  async processState(changeObjectBody) { 
    const currentState = changeObjectBody.status.state;
    logger.info(`routing ${currentState} to appropriate function..`);
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
      default:
        throw new errors.BadRequest(`Invalid state ${currentState} while bosh based restore operation.`);
    }
  }

  async processBoshStop(resourceOptions) { 
    try {
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      const oldTaskId = _.get(resourceOptions, 'restoreMetadata.stateResults.boshStop.taskId', undefined);

      if (!_.isEmpty(oldTaskId)) {
        await this.director.pollTaskStatusTillComplete(oldTaskId); 
      }
      const taskId = await this.director.stopDeployment(deploymentName); 
      let stateResult = _.assign({
        stateResults: {
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
        stateResults: {
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
      logger.error(`Error occurred while stopping the bosh deployment: ${err}`);
      await eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });

      return this.patchRestoreFileWithFinalResult(resourceOptions, 'failed');

    }
  }
  // TODO: Store the logs in restorefile or not?
  // TODO: Putting some threshold on disk creation.
  async processCreateDisk(resourceOptions) { 
    try {
      /* jshint unused:false */
      const snapshotId = _.get(resourceOptions, 'restoreMetadata.snapshotId');
      let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');

      /* jshint ignore: start */
      let createDiskFn = async instance => {
        logger.info(`Triggering disk creation with snapshotId: ${snapshotId}, az: ${instance.az} and type: ${instance.oldDiskInfo.type} for instance ${instance.id}`);
        instance.newDiskInfo = await this.cloudProvider.createDiskFromSnapshot(snapshotId, instance.az, {
          type: instance.oldDiskInfo.type
        });
      };
      /* jshint ignore: end */

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
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`
        }
      });
    } catch (err) {
      logger.error(`Error occurred while creating new disks: ${err}`);
      await eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });

      return this.patchRestoreFileWithFinalResult(resourceOptions, 'failed');
    }
  }

  async processAttachDisk(resourceOptions) { 
    try {
      /* jshint unused:false */
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      let deploymentInstancesInfo = _.get(resourceOptions, 'restoreMetadata.deploymentInstancesInfo');

      /* jshint ignore: start */
      let createDiskAttachmentTaskFn = async instance => {
        let taskId = _.get(instance, 'attachDiskTaskId', undefined);
        if (_.isEmpty(taskId)) {
          taskId = await this.director.createDiskAttachment(deploymentName, instance.newDiskInfo.volumeId,
            instance.job_name, instance.id);
          _.set(instance, 'attachDiskTaskId', taskId);
        }
      };
      /* jshint ignore: end */

      await Promise.all(deploymentInstancesInfo.map(createDiskAttachmentTaskFn)); 

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

      /* jshint ignore: start */
      let taskPollingFn = async instance => {
        let taskId = _.get(instance, 'attachDiskTaskId');
        instance.attachDiskTaskResult = await this.director.pollTaskStatusTillComplete(taskId);
      };
      /* jshint ignore: end */

      await Promise.all(deploymentInstancesInfo.map(taskPollingFn)); 

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
      await eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });

      return this.patchRestoreFileWithFinalResult(resourceOptions, 'failed');
    }
  }

  async processPutFile(resourceOptions) { 
    try {
      /* jshint unused:false */
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
      /* jshint ignore: start */
      let sshFn = async instance => {
        instance.sshResult = await this.director.runSsh(deploymentName, instance.job_name, instance.id, cmd);
      };
      /* jshint ignore: end */

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
          'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_RUN_ERRANDS`
        }
      });

    } catch (err) {
      logger.error(`Error occurred while putting file in deployment instances: ${err}`);
      await eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
      return this.patchRestoreFileWithFinalResult(resourceOptions, 'failed');
    }
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
        return [{
          'group': deploymentInstancesInfo[instanceIndex].job_name,
          'id': deploymentInstancesInfo[instanceIndex].id
        }];
    }
  }

  async runErrand(resourceOptions, errandType) { 
    assert.ok(_.includes(['baseBackupErrand', 'pointInTimeErrand', 'postStartErrand'], errandType), ` Errand type ${errandType} is invalid.`);
    const oldTaskId = _.get(resourceOptions, `stateResults.errands.${errandType}.taskId`, undefined);
    if (!_.isEmpty(oldTaskId)) {
      logger.info(`Older task for ${errandType} exists. Waiting for task ${oldTaskId}. Won't trigger errand again.`);
      const taskResult = await this.director.pollTaskStatusTillComplete(oldTaskId); 
      let errands = {};
      errands[errandType] = {
        taskId: taskIdForErrand,
        taskResult: taskResult
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
    const taskResult = await this.director.pollTaskStatusTillComplete(taskIdForErrand); 
    errands = {};
    stateResults = {};
    errands[errandType] = {
      taskId: taskIdForErrand,
      taskResult: taskResult
    };
    stateResults = _.assign({
      stateResults: {
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
      if (!_.isEmpty(timeStamp)) {
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
      await eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });

      return this.patchRestoreFileWithFinalResult(resourceOptions, 'failed');
    }
  }

  async processBoshStart(resourceOptions) { 
    try {
      const deploymentName = _.get(resourceOptions, 'restoreMetadata.deploymentName');
      const oldTaskId = _.get(resourceOptions, 'restoreMetadata.stateResults.boshStart.taskId', undefined);

      if (!_.isEmpty(oldTaskId)) {
        await this.director.pollTaskStatusTillComplete(oldTaskId); 
      }

      const taskId = await this.director.startDeployment(deploymentName); 
      let stateResult = _.assign({
        stateResults: {
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
      stateResult = {};
      stateResult = _.assign({
        stateResults: {
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
      await eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });

      return this.patchRestoreFileWithFinalResult(resourceOptions, 'failed');
    }
  }

  async processPostStart(resourceOptions) { 
    try {
      await this.runErrand(resourceOptions, 'postStartErrand'); 
      await eventmesh.apiServerClient.patchResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      });
      return this.patchRestoreFileWithFinalResult(resourceOptions, 'succeeded');
    } catch (err) {
      logger.error(`Error occurred in bosh post start: ${err}`);
      await eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: resourceOptions.restore_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });

      return this.patchRestoreFileWithFinalResult(resourceOptions, 'failed');
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
