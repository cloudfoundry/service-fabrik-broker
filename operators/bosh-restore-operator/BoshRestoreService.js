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

class BoshRestoreService extends BaseDirectorService {
  constructor(plan) {
    super(plan);
    this.plan = plan;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
    this.cloudProvider = cloudProvider;
  }

  async startRestore(changeObjectBody) {
    try {
      const opts = JSON.parse(changeObjectBody.spec.options);
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
          agent_ip: undefined,
          started_at: new Date().toISOString(),
          finished_at: null,
          tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid,
          snapshotId: _.get(backupMetadata, 'snapshotId'),
          deploymentName: deploymentName
        })
        .value();

        //create the restoreFile
        //update resource state to bosh_stop along with needed information
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, //TODO:
          resourceId: opts.restore_guid,
          status: {
            'state': `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`,
            'response': data
          }
        });
    } catch (err) {
      //Call the rollback function
    }
  }

  async processState(changeObjectBody) {
    const currentState = changeObjectBody.status.state;
    switch (currentState) {
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`:
        return processBoshStop(changeObjectBody);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`:
        return processCreateDisk(changeObjectBody);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`:
        return processAttachDisk(changeObjectBody);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_RUN_ERRANDS`:
        return processRunErrands(changeObjectBody);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`:
        return processBoshStart(changeObjectBody);
      case `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ROLLBACK`:
      default:

    }
  }

  async processBoshStop(changeObjectBody) {
    try {
      //1. Get deployment name from resource
      const resource = JSON.parse(changeObjectBody);
      const deploymentName = _.get(resource, 'status.response.deploymentName');

      //2. Stop the bosh deployment and poll for the result
      const taskId  = await this.director.stopDeployment(deploymentName);
      const task = await this.director.pollTaskStatusTillComplete(taskId);
      //3. Update the resource with next step
    } catch (err) {
      //Handle failure/rollback
    }
  }

  async processCreateDisk(changeObjectBody) {
    try {
      //1. get snapshot id from backup metadata
      const resource = JSON.parse(changeObjectBody);
      const snapshotId = _.get(resource, 'status.response.snapshotId');

      //2. create persistent disk from snapshot
      const diskData = await this.cloudProvider.createDiskFromSnapshot(snapshotId); //TODO: Add zones and required options
      //3. Store persistent disk information in resource to be used later
      //4. Update state
    } catch (err) {
      //Handle failure/rollback
    }
  }

  async processAttachDisk(changeObjectBody) {
    try { 
      //1. Get new disk CID from resource state
      const resource = JSON.parse(changeObjectBody);
      const diskCid = _.get(resource, 'status.response.newDiskCid');
      const deploymentName = _.get(resource, 'status.response.deploymentName');

      //2. Get job/instance pairs from config/resource to which new disk needs to be attached
      const jobInstancePairs = []; //TODO: Finalize on how to obtain it

    } catch (err) {

    }
  }

  async processRunErrands(changeObjectBody) {
    try {

    } catch (err) {

    }
  }

  async processBoshStart(changeObjectBody) {
    try {

    } catch (err) {

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