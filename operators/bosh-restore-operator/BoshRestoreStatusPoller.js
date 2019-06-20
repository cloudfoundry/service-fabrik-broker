'use strict';

const _ = require('lodash');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const logger = require('../../common/logger');
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
  /* Main router function*/
  async getStatus(resourceBody, intervalId) {
    const currentState = _.get(resourceBody, 'status.state');
    const changedOptions = _.get(resourceBody, 'spec.options');
    logger.info(`routing ${currentState} to appropriate function in poller..`);
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
        throw err; //Clear poller should be called in BaseStatusPoller due to this.
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

  /* helper poller functions */
  async _handleBoshStartStopPolling (changedOptions, operation, nextState, errorMsg, resourceName, intervalId) {
    const taskId = _.get(changedOptions, `stateResults.${operation}.taskId`, undefined);
    const taskResult = await this.director.getTask(taskId);
    if(!this.isBoshTaskInProgress(taskResult)) {
        let stateResult = {};
        let operations = {};
        operations[operation] = {
            taskId: taskId,
            taskResult: taskResult
        };
        stateResult = _.assign({
            stateResults: operations
        });
        const nextStateToPatch = this.isBoshTaskSucceeded(taskResult) ? nextState : CONST.APISERVER.RESOURCE_STATE.FAILED;
        await eventmesh.apiServerClient.patchResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
            resourceId: resourceOptions.restore_guid,
            options: stateResult,
            status: {
                'state': nextStateToPatch
            }
        });
        if(isBoshTaskSucceeded(taskResult)) {
            this.clearPoller(resourceName, intervalId); //Clear poller for polling of next state
        } else {
            throw new errors.InternalServerError(errorMsg);
        }
    }
  } 

  async _handleErrandPolling(resourceOptions, errandType, nextState, resourceName,intervalId ) {
    const taskId = _.get(resourceOptions, `stateResults.errands.${errandType}.taskId`, undefined);
    if(_.isEmpty(taskId)) {
        //This could happen if the corresponding errand is not defined in the service catalog.
        await eventmesh.apiServerClient.patchResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
            resourceId: resourceOptions.restore_guid,
            status: {
              'state': nextState //Do nothing and move to next state
            }
        });
        this.clearPoller(resourceName, intervalId); //Clear poller for polling of next state
    }
    const taskResult = await this.director.getTask(taskId);
    if(!this.isBoshTaskInProgress(taskResult)) {
        let errands = {};
        let stateResults = {};
        errands[errandType] = {
          taskId: taskId,
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
            this.clearPoller(resourceName, intervalId); //Clear poller for polling of next state
        } else {
            throw new errors.InternalServerError(`Errand ${errandType} failed as ${taskResult.state}. Check task ${taskId}`);
        }
    }
  }

  /* Entry functions for each of the state poller */
  async processInProgressBoshStop(changedOptions, resourceName, intervalId) {
    await this._handleBoshStartStopPolling(changedOptions, 'boshStop', `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`,
    `Stopping bosh deployment with id ${resourceName} failed.`,
    resourceName, intervalId);
  }

  async processInProgressAttachDisk(changedOptions, resourceName, intervalId) {
    let deploymentInstancesInfo = _.get(changedOptions, 'restoreMetadata.deploymentInstancesInfo');
    let allTasksSucceeded = true;
    let allTasksCompleted = true;
    let taskPollingFn = async instance => {
        let taskId = _.get(instance, 'attachDiskTaskId');
        if(_.isEmpty(taskId)) {
            throw new errors.InternalServerError(`Task id for attaching disk not found for instance ${instance.id}. Polling could not be continued.`);
        }
        let taskResult = await this.director.getTask(taskId);
        if(!this.isBoshTaskInProgress(taskResult)) {
            instance.attachDiskTaskResult = taskResult;
            if(!isBoshTaskSucceeded(taskResult)) allTasksSucceeded = false;
        } else allTasksCompleted = false;
    };
    await Promise.all(deploymentInstancesInfo.map(taskPollingFn)); 
    if (allTasksCompleted) {
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
        if (!allTasksSucceeded) {
            throw new errors.InternalServerError(`Attaching disk to some of the instances failed.`);
        }
        this.clearPoller(resourceName, intervalId); //Clear poller for polling of next state
    }
  }

  async processInProgressBaseBackupErrand(changedOptions, resourceName, intervalId) {
    await this._handleErrandPolling(changedOptions, 'baseBackupErrand', `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_PITR_ERRAND`, 
    resourceName, intervalId);
  }

  async processInProgressPitrErrand(changedOptions, resourceName, intervalId) {
    await this.handleErrandPolling(changedOptions, 'pointInTimeErrand', `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BOSH_START` , 
    resourceName, intervalId);
  }

  async processInProgressBoshStart(changedOptions, resourceName, intervalId) {
    await this._handleBoshStartStopPolling(changedOptions, 'boshStart', `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_POST_BOSH_START_ERRAND`,
    `Starting bosh deployment with id ${resourceName} failed.`,
    resourceName, intervalId);
  }

  async processInProgressPostBoshStart(changedOptions, resourceName, intervalId) {
    await this._handleErrandPolling(changedOptions, 'postStartErrand', CONST.APISERVER.RESOURCE_STATE.SUCCEEDED , 
    resourceName, intervalId);

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
