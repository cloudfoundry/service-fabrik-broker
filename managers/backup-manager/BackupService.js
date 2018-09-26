'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../common/config');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const bosh = require('../../data-access-layer/bosh');
const backupStore = require('../../data-access-layer/iaas').backupStore;
const utils = require('../../common/utils');
const eventmesh = require('../../data-access-layer/eventmesh');
const Agent = require('../../data-access-layer/service-agent');
const CONST = require('../../common/constants');
const BaseDirectorService = require('../BaseDirectorService');
const Forbidden = errors.Forbidden;

class BackupService extends BaseDirectorService {
  constructor(plan) {
    super(plan);
    this.plan = plan;
    this.director = bosh.director;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
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
      backupStarted = false;

    let deploymentName;
    return bosh
      .director
      .getDeploymentNameForInstanceId(opts.instance_guid).then(res => {
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
            data.agent_ip = agent_ip;
            return this.agent.startBackup(agent_ip, backup, vms);
          })
          .then(() => {
            backupStarted = true;
            return this.backupStore.putFile(data);
          })
          .then(() => {
            return data;
          });
      })
      //TODO-PR - Break it into multiple methods
      .then(backupInfo => {
        const response = _.extend(backupInfo, {
          deployment: deploymentName
        });
        return eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            resourceId: result.backup_guid,
            status: {
              'state': CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
              'response': response
            }
          })
          .then(() => backupInfo);
      })
      .catch(err => {
        return Promise
          .try(() => logger.error(`Error during start of backup - backup to be aborted : ${backupStarted} - backup to be deleted: ${metaUpdated} `, err))
          .then(() => eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            resourceId: result.backup_guid,
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              error: utils.buildErrorJson(err)
            }
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
        case CONST.BACKUP_OPERATION.SUCCEEDED:
          return {
            description: `${action} deployment ${deploymentName} succeeded at ${timestamp}`,
            state: CONST.BACKUP_OPERATION.SUCCEEDED
          };
        case CONST.BACKUP_OPERATION.ABORTED:
          return {
            description: `${action} deployment ${deploymentName} aborted at ${timestamp}`,
            state: CONST.BACKUP_OPERATION.FAILED
          };
        case CONST.BACKUP_OPERATION.FAILED:
          return {
            description: `${action} deployment ${deploymentName} failed at ${timestamp} with Error "${result.stage}"`,
            state: CONST.BACKUP_OPERATION.FAILED
          };
        default:
          return {
            description: `${action} deployment ${deploymentName} is still in progress: "${result.stage}"`,
            state: CONST.BACKUP_OPERATION.PROCESSING
          };
        }
      });
  }

  getLastBackup(tenant_id, instance_guid) {
    return this.backupStore
      .getBackupFile({
        tenant_id: tenant_id,
        service_id: this.plan.service.id,
        plan_id: this.plan.id,
        instance_guid: instance_guid
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
              .return({
                state: lastOperation.state,
                logs: logs,
                snapshotId: lastOperation.snapshotId,
                finished_at: new Date(Date.now())
                  .toISOString()
                  .replace(/\.\d*/, '')
              })
            )
            .then(patchObj => eventmesh.apiServerClient.patchResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
              resourceId: opts.backup_guid,
              status: {
                response: patchObj
              }
            }));
        }
      });
  }

  /**
   * @description Delete backup from backup store and Apiserver
   * @param {string} options.tenant_id
   * @param {string} options.service_id
   * @param {string} options.instance_guid
   * @param {string} options.backup_guid
   * @param {string} options.time_stamp
   */
  deleteBackup(options) {
    logger.info('Attempting delete with:', options);
    return this.backupStore
      .deleteBackupFile(options)
      .then(() => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: options.backup_guid,
        status: {
          'state': CONST.APISERVER.RESOURCE_STATE.DELETED
        }
      }))
      .catch(err => {
        return Promise
          .try(() => logger.error(`Error during delete of backup`, err))
          .then(() => eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            resourceId: options.backup_guid,
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED,
              error: utils.buildErrorJson(err)
            }
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
            .then(() => eventmesh.apiServerClient.updateResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
              resourceId: abortOptions.guid,
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
      })
      .catch(e => {
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: abortOptions.guid,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(e)
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

}

module.exports = BackupService;