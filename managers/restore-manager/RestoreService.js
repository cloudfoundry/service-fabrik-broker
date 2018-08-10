'use strict';

const _ = require('lodash');
const Agent = require('../../data-access-layer/service-agent');
const BaseDirectorService = require('../BaseDirectorService');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const Promise = require('bluebird');
const backupStore = require('../../data-access-layer/iaas').backupStore;
const config = require('../../common/config');
const logger = require('../../common/logger');

class RestoreService extends BaseDirectorService {
  constructor(plan) {
    super(plan);
    this.plan = plan;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
  }

  startRestore(opts) {
    const deploymentName = opts.deployment;
    const args = opts.arguments;
    const backupMetadata = _.get(args, 'backup');

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
        tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid
      })
      .value();

    const result = _
      .chain(opts)
      .pick('deployment')
      .assign({
        subtype: 'restore',
        agent_ip: undefined,
        tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid
      })
      .value();

    function normalizeVm(vm) {
      let vmParams = _.pick(vm, 'cid', 'agent_id', 'job', 'index');
      return _.set(vmParams, 'iaas_vm_metadata.vm_id', config.backup.provider.name === CONST.IAAS.AZURE ? vmParams.agent_id : vmParams.cid);
    }

    return Promise
      .all([
        this.getDeploymentIps(deploymentName),
        this.director.getDeploymentVms(deploymentName).map(normalizeVm)
      ])
      .spread((ips, vms) => this.agent
        .startRestore(ips, backup, vms)
        .tap(agent_ip => {
          // set data and result agent ip
          data.agent_ip = result.agent_ip = agent_ip;
          return this.backupStore
            .getRestoreFile(data)
            .catch(errors.NotFound, (err) => {
              logger.debug('Not found any restore data. May be first time.', err);
              //Restore file might not be found, first time restore.
              return;
            })
            .then(restoreMetadata => this.backupStore.putFile(_.assign(data, {
              restore_dates: _.get(restoreMetadata, 'restore_dates')
            })));
        }))
      .return(result);
  }

  static createService(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }


}
module.exports = RestoreService;