'use strict';

const Promise = require('bluebird');
const logger = require('../../common/logger');
const eventmesh = require('../../data-access-layer/eventmesh');
const catalog = require('../../common/models/catalog');
const utils = require('../../common/utils');
const CONST = require('../../common/constants');
const BaseOperator = require('../BaseOperator');
const BoshRestoreService = require('./');

class DefaultBoshRestoreOperator extends BaseOperator {

  init() {
    const RESTORE_STATES = [
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_RUN_ERRANDS`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`,
      `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`
    ];    
    const defaultValidStatelist = [
      CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
    ]; 
    const validStateList = defaultValidStatelist.concat(RESTORE_STATES);
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE, validStateList));
  }

  async processRequest(requestObjectBody) {
    if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
      return this.processInQueueRequest(requestObjectBody);
    }
    else {
      return this.processInProgressRequest(requestObjectBody)
    }
  }

  async processInQueueRequest(changeObjectBody) {
    try {
      const changedOptions = JSON.parse(changeObjectBody.spec.options);
      logger.info('Triggering restore with the following options:', changedOptions);
      const plan = catalog.getPlan(changedOptions.plan_id);
      let service = await BoshRestoreService.createService(plan)
      return service.startRestore(changedOptions); //pass entire object and not just spec.options
    } catch (err) {
    }
  }

  async processInProgressRequest(changeObjectBody) {
    try {
      const changedOptions = JSON.parse(changeObjectBody.spec.options);
      logger.info('Triggering restore with the following options:', changedOptions);
      const plan = catalog.getPlan(changedOptions.plan_id);
      let service = await BoshRestoreService.createService(plan)
      return service.processState(changeObjectBody); //pass entire object and not just spec.options
    } catch (err) {
    }
  }
}

module.exports = DefaultBoshRestoreOperator;