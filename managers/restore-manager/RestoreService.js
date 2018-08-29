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
const config = require('../../common/config');
const logger = require('../../common/logger');

class RestoreService extends BaseDirectorService {
  constructor(plan) {
    super(plan);
    this.plan = plan;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
  }

  getLastRestore(tenant_id, instance_guid) {
    return this.backupStore
      .getRestoreFile({
        tenant_id: tenant_id,
        service_id: this.plan.service.id,
        plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .then(metadata => {
        switch (metadata.state) {
        case 'processing':
          return this.agent
            .getRestoreLastOperation(metadata.agent_ip)
            .then(data => _.assign(metadata, _.pick(data, 'state', 'stage')));
        default:
          return metadata;
        }
      });
  }

  getOperationState(name, opts) {
    logger.info(`Retrieving state of last Restore with:`, opts);
    return this.getRestoreOperationState(opts)
      .then(result => {
        logger.info('Restore operation state', result);
        const deploymentName = opts.deployment;
        const action = _.capitalize(name);
        const timestamp = result.updated_at;
        //TODO-PR - Try to move to BaseService
        switch (result.state) {
        case CONST.RESTORE_OPERATION.SUCCEEDED:
          return {
            description: `${action} deployment ${deploymentName} succeeded at ${timestamp}`,
            state: CONST.RESTORE_OPERATION.SUCCEEDED
          };
        case CONST.RESTORE_OPERATION.ABORTED:
          return {
            description: `${action} deployment ${deploymentName} aborted at ${timestamp}`,
            state: CONST.RESTORE_OPERATION.FAILED
          };
        case CONST.RESTORE_OPERATION.FAILED:
          return {
            description: `${action} deployment ${deploymentName} failed at ${timestamp} with Error "${result.stage}"`,
            state: CONST.RESTORE_OPERATION.FAILED
          };
        default:
          return {
            description: `${action} deployment ${deploymentName} is still in progress: "${result.stage}"`,
            state: CONST.RESTORE_OPERATION.PROCESSING
          };
        }
      });
  }

  getRestoreOperationState(opts) {
    logger.debug('Getting Restore operation State for:', opts);
    const agent_ip = opts.agent_ip;
    const options = _.assign({
      service_id: this.plan.service.id,
      plan_id: this.plan.id,
      tenant_id: opts.context ? this.getTenantGuid(opts.context) : opts.tenant_id
    }, opts);

    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }

    let statusAlreadyChecked = false;
    return this.agent
      .getRestoreLastOperation(agent_ip)
      .tap(lastOperation => {
        if (isFinished(lastOperation.state)) {
          return Promise.all([this.agent
              .getRestoreLogs(agent_ip), this.backupStore
              .getRestoreFile(options)
            ])
            .spread((logs, restoreMetadata) => {
              const restoreFinishiedAt = lastOperation.updated_at ? new Date(lastOperation.updated_at).toISOString() : new Date().toISOString();
              // following restoreDates will have structure
              // 'restore_dates' : {'succeeded':[<dateISOString>], 'failed':[<dateISOString>],'aborted':[<dateISOString>]}
              let restoreDates = _.get(restoreMetadata, 'restore_dates') || {};
              let restoreDatesByState = _.get(restoreDates, lastOperation.state) || [];
              //status check to prevent
              if (_.indexOf(restoreDatesByState, restoreFinishiedAt) !== -1) {
                statusAlreadyChecked = true;
                logger.debug(`Restore status check came once again even after finish for instance ${options.instance_guid}`);
              } else {
                restoreDatesByState.push(restoreFinishiedAt);
              }
              //following can be treated as extra processing
              // just to avoid duplicate entries in restore histroy
              // which might lead to quota full
              let uniqueDates = [...new Set(restoreDatesByState)];
              const patchObj = {
                state: lastOperation.state,
                logs: logs,
                finished_at: restoreFinishiedAt,
                restore_dates: _.chain(restoreDates)
                  .set(lastOperation.state, _.sortBy(uniqueDates))
                  .value()
              };
              return this.backupStore
                .patchRestoreFile(options, patchObj)
                .then(() => eventmesh.apiServerClient.patchResource({
                  resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
                  resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
                  resourceId: opts.restore_guid,
                  status: {
                    response: patchObj
                  }
                }));
            })
            .tap(() => {
              // Trigger schedule backup when restore is successful
              // statusAlreadyChecked should be false, otherwise
              // if by chance restore state (this function called) two times
              // for any reason after agent restores successfully,
              // on seceond time also it would trigger schedule backup (which is incorrect).
              if (lastOperation.state === CONST.OPERATION.SUCCEEDED &&
                !statusAlreadyChecked) {
                return this.reScheduleBackup({
                  instance_id: options.instance_guid,
                  afterXminute: config.backup.reschedule_backup_delay_after_restore || CONST.BACKUP.RESCHEDULE_BACKUP_DELAY_AFTER_RESTORE
                });
              } else {
                logger.debug(`Not re-scheduling backup for ${options.instance_guid} as current restore state check is not first time.`);
                return;
              }
            });
        }
      });
  }

  reScheduleBackup(opts) {
    const options = {
      instance_id: opts.instance_id,
      repeatInterval: 'daily',
      type: CONST.BACKUP.TYPE.ONLINE
    };

    if (this.plan.service.backup_interval) {
      options.repeatInterval = this.plan.service.backup_interval;
    }

    options.repeatInterval = utils.getCronWithIntervalAndAfterXminute(options.repeatInterval, opts.afterXminute);
    logger.info(`Scheduling Backup for instance : ${options.instance_id} with backup interval of - ${options.repeatInterval}`);
    //Even if there is an error while fetching backup schedule, trigger backup schedule we would want audit log captured and riemann alert sent
    return retry(() => cf.serviceFabrikClient.scheduleBackup(options), {
      maxAttempts: 3,
      minDelay: 500
    });
  }

  startRestore(opts) {
    logger.debug('Starting restore with options:', opts);
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
          data.agent_ip = agent_ip;
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
      .then(() => {
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
          resourceId: opts.restore_guid,
          status: {
            'state': CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
            'response': data
          }
        });
      });
  }

  static createService(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }

  abortLastRestore(abortOptions) {
    const tenant_id = abortOptions.context ? this.getTenantGuid(abortOptions.context) : abortOptions.tenant_id;
    const instance_guid = abortOptions.instance_guid;
    logger.debug(`Aborting restore ${abortOptions.restore_guid} with tenant_id: ${tenant_id} and instance_guid: ${instance_guid}`);
    return this.backupStore
      .getRestoreFile({
        tenant_id: tenant_id,
        service_id: this.plan.service.id,
        plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .then(metadata => {
        switch (metadata.state) {
        case 'processing':
          return this.agent
            .abortRestore(metadata.agent_ip)
            .then(() => eventmesh.apiServerClient.updateResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
              resourceId: abortOptions.restore_guid,
              status: {
                'state': CONST.OPERATION.ABORTING
              }
            }))
            .return({
              state: CONST.OPERATION.ABORTING
            });
        default:
          return _.pick(metadata, 'state');
        }
      });
  }

}
module.exports = RestoreService;