'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../broker/lib/config');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const bosh = require('../../broker/lib/bosh');
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const backupStore = require('../../broker/lib/iaas').backupStore;
const utils = require('../../broker/lib/utils');
const eventmesh = require('../../eventmesh');
const Agent = require('../../broker/lib/fabrik/Agent');
const ScheduleManager = require('../../broker/lib/jobs');
const CONST = require('../../broker/lib/constants');
const Forbidden = errors.Forbidden;

class BackupService {
  constructor(plan) {
    this.plan = plan;
    this.director = bosh.director;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
  }

  get settings() {
    return this.plan.manager.settings;
  }

  get subnet() {
    return this.settings.subnet || this.service.subnet;
  }

  static get prefix() {
    return _
      .reduce(config.directors,
        (prefix, director) => director.primary === true ? director.prefix : prefix,
        null) || CONST.SERVICE_FABRIK_PREFIX;
  }

  static getDeploymentName(guid, networkSegmentIndex) {
    let subnet = this.subnet ? `_${this.subnet}` : '';
    return `${BackupService.prefix}${subnet}-${NetworkSegmentIndex.adjust(networkSegmentIndex)}-${guid}`;
  }

  //TODO-PR - Move the common piece of codes in BaseService which can be leveraged by other Service classes
  static parseDeploymentName(deploymentName, subnet) {
    return _
      .chain(utils.deploymentNameRegExp(subnet).exec(deploymentName))
      .slice(1)
      .tap(parts => parts[1] = parts.length ? parseInt(parts[1]) : undefined)
      .value();
  }

  static getNetworkSegmentIndex(deploymentName) {
    return _.nth(BackupService.parseDeploymentName(deploymentName, this.subnet), 1);
  }

  static findNetworkSegmentIndex(guid) {
    logger.info(`Finding network segment index of an existing deployment with instance id '${guid}'...`);
    return bosh
      .director
      .getDeploymentNameForInstanceId(guid)
      .then(deploymentName => BackupService.getNetworkSegmentIndex(deploymentName))
      .tap(networkSegmentIndex => logger.info(`+-> Found network segment index '${networkSegmentIndex}'`));
  }

  getTenantGuid(context) {
    if (context.platform === CONST.PLATFORM.CF) {
      return context.space_guid;
    } else if (context.platform === CONST.PLATFORM.K8S) {
      return context.namespace;
    }
  }

  getDeploymentIps(deploymentName) {
    return this.director.getDeploymentIps(deploymentName);
  }
  //TODO-PR - static method to non-static
  static registerBnRStatusPoller(opts, instanceInfo) {
    let deploymentName = _.get(instanceInfo, 'deployment');
    const checkStatusInEveryThisMinute = config.backup.backup_restore_status_check_every / 60000;
    logger.debug(`Scheduling deployment ${deploymentName} ${opts.operation} for backup guid ${instanceInfo.backup_guid}
          ${CONST.JOB.BNR_STATUS_POLLER} for every ${checkStatusInEveryThisMinute}`);
    const repeatInterval = `*/${checkStatusInEveryThisMinute} * * * *`;
    const data = {
      operation: opts.operation,
      type: opts.type,
      trigger: opts.trigger,
      operation_details: instanceInfo
    };
    return ScheduleManager
      .schedule(
        `${deploymentName}_${opts.operation}_${instanceInfo.backup_guid}`,
        CONST.JOB.BNR_STATUS_POLLER,
        repeatInterval,
        data, {
          name: config.cf.username
        }
      );
  }

  startBackup(opts) {
    const args = opts.arguments;
    const backup = _
      .chain(opts)
      .pick('guid')
      .assign({
        type: _.get(args, 'type', 'online'),
        secret: undefined,
        trigger: _.get(args, 'trigger', CONST.BACKUP.TRIGGER.ON_DEMAND)
      })
      .value();
    const backupStartedAt = new Date().toISOString();
    const data = _
      .chain(opts)
      .pick('service_id', 'plan_id', 'organization_guid', 'instance_guid', 'username')
      .assign({
        operation: CONST.OPERATION_TYPE.BACKUP,
        type: backup.type,
        backup_guid: backup.guid,
        trigger: backup.trigger,
        state: 'processing',
        secret: undefined,
        agent_ip: undefined,
        started_at: backupStartedAt,
        finished_at: null,
        tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid
      })
      .value();

    let instanceInfo;
    const result = _
      .chain(opts)
      .pick('deployment')
      .assign({
        subtype: CONST.OPERATION_TYPE.BACKUP,
        backup_guid: backup.guid,
        agent_ip: undefined,
        tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid,
        description: `${backup.trigger} backup triggerred by ${data.username} at ${data.started_at}`
      })
      .value();

    function createSecret() {
      return utils
        .randomBytes(12)
        .then(buffer => buffer.toString('base64'));
    }

    function normalizeVm(vm) {
      let vmParams = _.pick(vm, 'cid', 'agent_id', 'job', 'index');
      return _.set(vmParams, 'iaas_vm_metadata.vm_id', config.backup.provider.name === CONST.IAAS.AZURE ? vmParams.agent_id : vmParams.cid);
    }

    let metaUpdated = false,
      backupStarted = false,
      registeredStatusPoller = false;

    let deploymentName;
    //TODO-PR - Use getDeploymentNameForInstanceId from BoshDirectorClient
    return BackupService
      .findNetworkSegmentIndex(opts.instance_guid)
      .then(networkIndex => BackupService.getDeploymentName(opts.instance_guid, networkIndex))
      .then(res => {
        deploymentName = res;
        logger.info('Obtained the deployment name for instance :', deploymentName);
      })
      .then(() => Promise.all([
        createSecret(),
        this.getDeploymentIps(deploymentName),
        this.director.getDeploymentVms(deploymentName).map(normalizeVm)
      ]))
      .spread((secret, ips, vms) => {
        // set data and backup secret
        logger.info(`Starting backup on - ${deploymentName}. Agent Ips for deployment - `, ips);
        data.secret = backup.secret = secret;
        return this.agent
          .getHost(ips, 'backup')
          .then(agent_ip => {
            data.agent_ip = result.agent_ip = agent_ip;
            instanceInfo = _.chain(data)
              .pick('tenant_id', 'backup_guid', 'instance_guid', 'agent_ip', 'service_id', 'plan_id')
              .set('deployment', deploymentName)
              .set('started_at', backupStartedAt)
              .value();
            return BackupService.registerBnRStatusPoller({
                operation: CONST.OPERATION_TYPE.BACKUP,
                type: backup.type,
                trigger: backup.trigger
              }, instanceInfo)
              .return(agent_ip);
          })
          .then(agent_ip => {
            registeredStatusPoller = true;
            return this.agent.startBackup(agent_ip, backup, vms);
          })
          .then(() => {
            backupStarted = true;
            let put_ret = this.backupStore.putFile(data);
            logger.debug(put_ret);
            return data;
          });
      })
      //TODO-PR - Break it into multiple methods
      //TODO-PR - Update state and response as part of single comment
      .then(backupInfo =>
        eventmesh.apiServerClient.updateOperationResponse({
          resourceId: opts.instance_guid,
          operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
          operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
          operationId: result.backup_guid,
          value: backupInfo
        })
        .then(() =>
          eventmesh.apiServerClient.updateOperationState({
            resourceId: opts.instance_guid,
            operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
            operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
            operationId: result.backup_guid,
            stateValue: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
          })
        )
      )
      //TODO-PR - Dowe need to fetch it from APIServer??
      .then(() => {
        return eventmesh.apiServerClient.getOperationResponse({
          resourceId: opts.instance_guid,
          operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
          operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
          operationId: result.backup_guid,
        });
      })
      .catch(err => {
        return Promise
          .try(() => logger.error(`Error during start of backup - backup to be aborted : ${backupStarted} - backup to be deleted: ${metaUpdated} `, err))
          .tap(() => {
            if (registeredStatusPoller) {
              logger.error(`Error occurred during backup process. Cancelling status poller for deployment : ${deploymentName} and backup_guid: ${backup.guid}`);
              return ScheduleManager
                .cancelSchedule(`${deploymentName}_backup_${backup.guid}`,
                  CONST.JOB.BNR_STATUS_POLLER)
                .catch((err) => logger.error('Error occurred while performing clean up of backup failure operation : ', err));
            }
          })
          .then(() => eventmesh.apiServerClient.updateOperationState({
            resourceId: opts.instance_guid,
            operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
            operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
            operationId: result.backup_guid,
            stateValue: CONST.APISERVER.RESOURCE_STATE.ERROR
          }))
          .then(() => eventmesh.apiServerClient.updateOperationResponse({
            resourceId: opts.instance_guid,
            operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
            operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
            operationId: result.backup_guid,
            value: err
          }))
          .then(() => {
            if (backupStarted) {
              logger.error(`Error occurred during backup process. Aborting backup on deployment : ${deploymentName}`);
              return this
                .abortLastBackup(opts, true)
                .finally(() => {
                  if (metaUpdated) {
                    const options = _
                      .chain(data)
                      .pick(data, 'tenant_id', 'backup_guid')
                      .set('force', true)
                      .value();
                    logger.error(`Error occurred during backup process. Deleting backup file on deployment : ${deploymentName} - backup file:`, options);
                    return this.backupStore
                      .deleteBackupFile(options);
                  }
                })
                .catch((err) => logger.error('Error occurred while performing clean up of backup failure operation : ', err));
            }
          }).then(() => {
            throw err;
          });
      });
  }

  getOperationState(name, opts) {
    logger.info(`Retrieving state of last Backup with:`, opts);
    return this.getBackupOperationState(opts)
      .then(result => {
        const deploymentName = opts.deployment;
        const action = _.capitalize(name);
        const timestamp = result.updated_at;
        //TODO-PR - Try to move to BaseService
        switch (result.state) {
        case CONST.APISERVER.RESOURCE_STATE.SUCCEEDED:
          return {
            description: `${action} deployment ${deploymentName} succeeded at ${timestamp}`,
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
          };
        case CONST.APISERVER.RESOURCE_STATE.ABORTED:
          return {
            description: `${action} deployment ${deploymentName} aborted at ${timestamp}`,
            state: CONST.APISERVER.RESOURCE_STATE.FAILED
          };
        case CONST.APISERVER.RESOURCE_STATE.FAILED:
          return {
            description: `${action} deployment ${deploymentName} failed at ${timestamp} with Error "${result.stage}"`,
            state: CONST.APISERVER.RESOURCE_STATE.FAILED
          };
        default:
          return {
            description: `${action} deployment ${deploymentName} is still in progress: "${result.stage}"`,
            state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
          };
        }
      });
  }

  getBackupOperationState(opts) {
    logger.debug('Getting Backup operation State for:', opts);
    const agent_ip = opts.agent_ip;
    const options = _.assign({
      service_id: this.plan.service.id,
      plan_id: this.plan.id,
      tenant_id: opts.context ? this.getTenantGuid(opts.context) : opts.tenant_id
    }, opts);

    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }

    return this.agent
      .getBackupLastOperation(agent_ip)
      .tap(lastOperation => {
        if (isFinished(lastOperation.state)) {
          return this.agent
            .getBackupLogs(agent_ip)
            .tap(logs => _.each(logs, log => logger.info(`Backup log for: ${opts.instance_guid} - ${JSON.stringify(log)}`)))
            .then(logs => this.backupStore
              .patchBackupFile(options, {
                state: lastOperation.state,
                logs: logs,
                snapshotId: lastOperation.snapshotId
              })
            );
        }
      });
  }

  deleteBackup(options) {
    logger.info('Attempting delete with:', options);
    return this.backupStore
      .deleteBackupFile(options)
      .then(() => eventmesh.apiServerClient.updateOperationState({
        resourceId: options.instance_guid,
        operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        operationId: options.backup_guid,
        stateValue: CONST.APISERVER.RESOURCE_STATE.DELETED
      }))
      .catch(err => {
        return Promise
          .try(() => logger.error(`Error during delete of backup`, err))
          //TODO-PR - Do it in one call
          .then(() => eventmesh.apiServerClient.updateOperationState({
            resourceId: options.instance_guid,
            operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
            operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
            operationId: options.backup_guid,
            stateValue: CONST.APISERVER.RESOURCE_STATE.ERROR
          }))
          .then(() => eventmesh.apiServerClient.updateOperationResponse({
            resourceId: options.instance_guid,
            operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
            operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
            operationId: options.guid,
            value: err
          }));
      });
  }

  abortLastBackup(abortOptions, force) {
    logger.info('Starting abort with following options:', abortOptions);
    return this.backupStore
      .getBackupFile({
        tenant_id: this.getTenantGuid(abortOptions.context),
        service_id: abortOptions.service_id,
        instance_guid: abortOptions.instance_guid
      }).then(metadata => {
        if (!force && metadata.trigger === CONST.BACKUP.TRIGGER.SCHEDULED) {
          throw new Forbidden('System scheduled backup runs cannot be aborted');
        }
        switch (metadata.state) {
        case 'processing':
          return this.agent
            .abortBackup(metadata.agent_ip)
            .then(() => eventmesh.apiServerClient.updateOperationState({
              resourceId: abortOptions.instance_guid,
              operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
              operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
              operationId: abortOptions.guid,
              stateValue: CONST.OPERATION.ABORTING
            }))
            .return({
              state: CONST.OPERATION.ABORTING
            });
        default:
          return _.pick(metadata, 'state');
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

module.exports = BackupService;