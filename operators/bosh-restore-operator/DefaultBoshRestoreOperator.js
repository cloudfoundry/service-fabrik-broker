'use strict';

const logger = require('../../common/logger');
const eventmesh = require('../../data-access-layer/eventmesh');
const catalog = require('../../common/models/catalog');
const CONST = require('../../common/constants');
const BaseOperator = require('../BaseOperator');
const BoshRestoreService = require('./');

class DefaultBoshRestoreOperator extends BaseOperator {

  init() {
    const RESTORE_STATES = [
      `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BOSH_STOP`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`,
      `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_ATTACH_DISK`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`,
      `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BASEBACKUP_ERRAND`,
      `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_PITR_ERRAND`,
      `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_BOSH_START`,
      `${CONST.APISERVER.RESOURCE_STATE.TRIGGER}_POST_BOSH_START_ERRAND`
    ];
    const defaultValidStatelist = [
      CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
    ];
    const validStateList = defaultValidStatelist.concat(RESTORE_STATES);
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE, validStateList));
  }

  async processRequest(requestObjectBody) { 
    try {
      if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
        await this.processInQueueRequest(requestObjectBody); 
      } else {
        await this.processInProgressRequest(requestObjectBody); 
      }
    } catch (err) {
      logger.error('Following error occurred while processing the restore request: ', err);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE,
        resourceId: requestObjectBody.metadata.name,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.FAILED
        }
      });
    }
  }

  async processInQueueRequest(changeObjectBody) { 
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering restore with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    let service = await BoshRestoreService.createService(plan); 
    return service.startRestore(changedOptions);
  }

  async processInProgressRequest(changeObjectBody) { 
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Continuing restore with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    let service = await BoshRestoreService.createService(plan); 
    return service.processState(changeObjectBody);
  }
}

module.exports = DefaultBoshRestoreOperator;
