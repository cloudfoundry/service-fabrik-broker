'use strict';

const _ = require('lodash');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const BaseStatusPoller = require('../BaseStatusPoller');
const bosh = require('../../data-access-layer/bosh');
const errors = require('../../common/errors');
const BoshRestoreService = require('./');

class BoshRestoreStatusPoller extends BaseStatusPoller {
  constructor() {
    super({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      validStateList: [`${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BASEBACKUP_ERRAND`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PITR_ERRAND`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`],
      validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED, CONST.API_SERVER.WATCH_EVENT.MODIFIED],
      pollInterval: config.backup.backup_restore_status_check_every 
    });
    this.director = bosh.director;
  }

  async getStatus(resourceBody, intervalId) {
    const currentState = _.get(resourceBody, 'status.state');
    const changedOptions = _.get(resourceBody, 'spec.options');
    try {
        switch(currentState) {
            case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`:
                await processInProgressBoshStop(changedOptions, resourceBody.metadata.name, intervalId);
                break;
            case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`:
                await processInProgressAttachDisk(changedOptions, resourceBody.metadata.name, intervalId);
                break;
            case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BASEBACKUP_ERRAND`:
                await processInProgressBaseBackupErrand(changedOptions, resourceBody.metadata.name, intervalId);
                break;
            case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PITR_ERRAND`:
                await processInProgressPitrErrand(changedOptions, resourceBody.metadata.name, intervalId);
                break;
            case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`:
                await processInProgressBoshStart(changedOptions, resourceBody.metadata.name, intervalId);
                break;
            case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`:
                await processInProgressPostBoshStart(changedOptions, resourceBody.metadata.name, intervalId);
                break;
        }
    } catch (err) {
        logger.error(`Error occurred in state ${currentState}: ${err}`);
        const plan = catalog.getPlan(changedOptions.plan_id);
        let service = await BoshRestoreService.createService(plan);
        const patchObj = await service.createPatchObject(changedOptions, 'failed');
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
        await service.patchRestoreFileWithFinalResult(changedOptions, patchObj);
        throw err;
    }
  }

  isBoshTaskSucceeded(taskResult) {
    if(taskResult.state === 'done') return true;
    else return false;
  }

  isBoshTaskInProgress(taskResult) {
    if(taskResult.state === 'processing') return true;
    else return false;
  }

  async processInProgressBoshStop(changedOptions, resourceName, intervalId) {
    const taskId = _.get(changedOptions, 'restoreMetadata.stateResults.boshStop.taskId', undefined);
    const taskResult = await this.director.getTask(taskId);
    if(!this.isBoshTaskInProgress(taskResult)) {
        stateResult = {};
        stateResult = _.assign({
          stateResults: {
            'boshStop': {
              taskId: taskId,
              taskResult: taskResult
            }
          }
        });
        const nextState = this.isBoshTaskSucceeded(taskResult) ? `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK` : CONST.APISERVER.RESOURCE_STATE.FAILED;
        await eventmesh.apiServerClient.patchResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
            resourceId: resourceOptions.restore_guid,
            options: stateResult,
            status: {
                'state': nextState
            }
        });
        if(isBoshTaskSucceeded(taskResult)) {
            this.clearPoller(resourceName, intervalId);
        } else {
            throw new errors.InternalServerError(`Stopping the bosh deployment failed as ${taskResult.state}. Check bosh-sf task ${taskId}`);
        }
    }
  }

  async processInProgressAttachDisk(changedOptions, resourceName, intervalId) {
    let deploymentInstancesInfo = _.get(changedOptions, 'restoreMetadata.deploymentInstancesInfo');
    let allTasksSucceeded = true;
    let allTasksCompleted = true;
    let taskPollingFn = async instance => {
        let taskId = _.get(instance, 'attachDiskTaskId');
        let taskResult = await this.director.getTask(taskId);
        if(!this.isBoshTaskInProgress(taskResult)) {
            instance.attachDiskTaskResult = taskResult;
            if(!isBoshTaskSucceeded(taskResult)) allTasksSucceeded = false;
        } else allTasksCompleted = false;
    };
    await Promise.all(deploymentInstancesInfo.map(taskPollingFn)); 
    if (allTasksCompleted){
        const nextState = allTasksSucceeded ? `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`: CONST.APISERVER.RESOURCE_STATE.FAILED;
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
                'state': nextState
            }
        });
        this.clearPoller(resourceName, intervalId);
        if (!allTasksSucceeded) {
            throw new errors.InternalServerError(`Attching disk to some of the instances failed.`);
        }
    }
  }

  async handleErrandPolling(resourceOptions, errandType, nextState, resourceName,intervalId ) {
    const taskId = _.get(resourceOptions, `stateResults.errands.${errandType}.taskId`, undefined);
    if(_.isEmpty(taskId)) {
        //This could happen if the corresponding errand is not defined in the service catalog.
        await eventmesh.apiServerClient.patchResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
            resourceId: resourceOptions.restore_guid,
            options: stateResults,
            status: {
              'state': nextState 
            }
        });
        this.clearPoller(resourceName, intervalId);
    }
    const taskResult = await this.director.getTask(taskId);
    if(!this.isBoshTaskInProgress(taskResult)) {
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
        const nextStateToPatch = this.isBoshTaskSucceeded(taskResult) ? nextState : CONST.APISERVER.RESOURCE_STATE.FAILED;
        await eventmesh.apiServerClient.patchResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
          resourceId: resourceOptions.restore_guid,
          options: stateResults,
          status: {
            'state': nextStateToPatch
          }
        });
        if(isBoshTaskSucceeded(taskResult)) {
            this.clearPoller(resourceName, intervalId);
        } else {
            throw new errors.InternalServerError(`Errand ${errandType} failed as ${taskResult.state}. Check task ${taskId}`);
        }
    }
  }

  async processInProgressBaseBackupErrand(changedOptions, resourceName, intervalId) {
    await this.handleErrandPolling(changedOptions, 'baseBackupErrand', `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_PITR_ERRAND`, resourceName, intervalId);
  }

  async processInProgressPitrErrand(changedOptions, resourceName, intervalId) {
    await this.handleErrandPolling(changedOptions, 'pointInTimeErrand', `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BOSH_START` , resourceName, intervalId);
  }

  async processInProgressBoshStart(changedOptions, resourceName, intervalId) {
    const taskId = _.get(changedOptions, 'restoreMetadata.stateResults.boshStart.taskId', undefined);
    const taskResult = await this.director.getTask(taskId);
    if(!this.isBoshTaskInProgress(taskResult)) { 
        stateResult = {};
        stateResult = _.assign({
        stateResults: {
            'boshStart': {
            taskId: taskId,
            taskResult: taskResult
            }
        }
        });
        const nextState = this.isBoshTaskSucceeded(taskResult) ? `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_POST_BOSH_START_ERRAND` : CONST.APISERVER.RESOURCE_STATE.FAILED;
        await eventmesh.apiServerClient.patchResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
            resourceId: resourceOptions.restore_guid,
            options: stateResult,
            status: {
                'state': nextState
            }
        });
        if(isBoshTaskSucceeded(taskResult)) {
            this.clearPoller(resourceName, intervalId);
        } else {
            throw new errors.InternalServerError(`Starting the bosh deployment failed as ${taskResult.state}. Check bosh-sf task ${taskId}`);
        }
    }
  }

  async processInProgressPostBoshStart(changedOptions, resourceName, intervalId) {
    await this.handleErrandPolling(changedOptions, 'postStartErrand', CONST.APISERVER.RESOURCE_STATE.SUCCEEDED , resourceName, intervalId);

    const plan = catalog.getPlan(changedOptions.plan_id);
    let service = await BoshRestoreService.createService(plan);
    const patchObj = await service.createPatchObject(resourceOptions, 'succeeded');
    let patchResourceObj = {
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
      resourceId: resourceOptions.restore_guid,
      status: {
        'state': CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
      }
    };
    if(!_.isEmpty(patchObj)) {
      _.set(patchResourceObj, 'status.response', patchObj);
    }
    await eventmesh.apiServerClient.patchResource(patchResourceObj);
    await service.patchRestoreFileWithFinalResult(resourceOptions, patchObj);
    if (this.service.pitr === true) {
      this.reScheduleBackup({
        instance_id: resourceOptions.instance_guid,
        afterXminute: config.backup.reschedule_backup_delay_after_restore || CONST.BACKUP.RESCHEDULE_BACKUP_DELAY_AFTER_RESTORE
      });
    }
  }

}

module.exports = BoshRestoreStatusPoller;
