'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../broker/lib/config');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const bosh = require('../../broker/lib/bosh');
const backupStore = require('../../broker/lib/iaas').backupStore;
const utils = require('../../broker/lib/utils');
const eventmesh = require('../../eventmesh');
const Agent = require('../../broker/lib/fabrik/Agent');
const ScheduleManager = require('../../broker/lib/jobs');
const CONST = require('../../broker/lib/constants');
const BoshDirectorClient = bosh.BoshDirectorClient;
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const EvaluationContext = bosh.EvaluationContext;
const Networks = bosh.manifest.Networks;
const Header = bosh.manifest.Header;
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;
const NotImplemented = errors.NotImplemented;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotOperational = errors.ServiceInstanceNotOperational;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const Forbidden = errors.Forbidden;
const catalog = require('../../broker/lib/models/catalog');

class BackupManager {
  constructor(plan) {
    this.plan = plan;
    this.director = bosh.director;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
  }

  get name() {
    return this.plan.manager.name;
  }

  get settings() {
    return this.plan.manager.settings;
  }

  getTenantGuid(context) {
    if (context.platform === CONST.PLATFORM.CF) {
      return context.space_guid;
    } else if (context.platform === CONST.PLATFORM.K8S) {
      return context.namespace;
    }
  }

  static get prefix() {
    return CONST.SERVICE_FABRIK_PREFIX;
  }

  static get instanceConstructor() {
    throw new NotImplementedBySubclass('instanceConstructor');
  }

  static load(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }

  getDeploymentNames(queued) {
    return this.director.getDeploymentNames(queued);
  }

  getDeploymentIps(deploymentName) {
    return this.director.getDeploymentIps(deploymentName);
  }

  getServiceFabrikOperationState(name, opts) {
    logger.info(`Retrieving state of last service fabrik operation '${name}' with:`, opts);
    return Promise
      .try(() => {
        switch (name) {
        case 'backup':
          return this.getBackupOperationState(opts);
        case 'restore':
          return this.getRestoreOperationState(opts);
        }
        throw new BadRequest(`Invalid service fabrik operation '${name}'`);
      })
      .then(result => {
        const deploymentName = opts.deployment;
        const action = _.capitalize(name);
        const timestamp = result.updated_at;
        switch (result.state) {
        case 'succeeded':
          return {
            description: `${action} deployment ${deploymentName} succeeded at ${timestamp}`,
            state: 'succeeded'
          };
        case 'aborted':
          return {
            description: `${action} deployment ${deploymentName} aborted at ${timestamp}`,
            state: 'failed'
          };
        case 'failed':
          return {
            description: `${action} deployment ${deploymentName} failed at ${timestamp} with Error "${result.stage}"`,
            state: 'failed'
          };
        default:
          return {
            description: `${action} deployment ${deploymentName} is still in progress: "${result.stage}"`,
            state: 'in progress'
          };
        }
      });
  }

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
    const deploymentName = opts.deployment;
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
        operation: 'backup',
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
        subtype: 'backup',
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

    // const lockInfo = {
    //   username: data.username,
    //   lockForOperation: `${data.trigger}_${data.operation}`
    // };
    // let lockAcquired = false,
    let metaUpdated = false,
      backupStarted = false;

    return Promise
      .all([
        createSecret(),
        this.getDeploymentIps(deploymentName),
        this.director.getDeploymentVms(deploymentName).map(normalizeVm)
      ])
      .spread((secret, ips, vms) => {
        // set data and backup secret
        logger.info(`Starting backup on - ${deploymentName}. Agent Ips for deployment - `, ips);
        data.secret = backup.secret = secret;
        return this.agent
          .getHost(ips, 'backup')
          .tap(agent_ip => {
            data.agent_ip = result.agent_ip = agent_ip;
            instanceInfo = _.chain(data)
              .pick('tenant_id', 'backup_guid', 'instance_guid', 'agent_ip', 'service_id', 'plan_id')
              .set('deployment', deploymentName)
              .set('started_at', backupStartedAt)
              .value();
            return BackupManager.registerBnRStatusPoller({
              operation: 'backup',
              type: backup.type,
              trigger: backup.trigger
            }, instanceInfo);
          })
          .then(agent_ip => {
            return this.agent.startBackup(agent_ip, backup, vms);
          })
          .then(() => {
            backupStarted = true;
            let put_ret = this.backupStore.putFile(data);
            const val1 = _.chain(data)
              .set('deployment_name', deploymentName)
              .set('started_at', backupStartedAt)
              .value()
            logger.info(`Backup is initiated with the options: `, val1);
            return val1;
          });
      })
      .then((res) => {
        const eventmesh_opts = {
          resourceId: opts.instance_guid,
          annotationName: 'backup',
          annotationType: 'default',
          annotationId: result.backup_guid,
          key: 'result',
          value: JSON.stringify(res, null, 2)
        }
        return eventmesh.server.updateAnnotationKey(eventmesh_opts)
      })
      .then(() => {
        const eventmesh_opts = {
          resourceId: opts.instance_guid,
          annotationName: 'backup',
          annotationType: 'default',
          annotationId: result.backup_guid,
          stateValue: CONST.RESOURCE_STATE.IN_PROGRESS
        }
        return eventmesh.server.updateAnnotationState(eventmesh_opts)
      })
      .then(() => {
        const eventmesh_opts = {
          resourceId: opts.instance_guid,
          annotationName: 'backup',
          annotationType: 'default',
          annotationId: result.backup_guid,
          key: 'result'
        }
        return eventmesh.server.getAnnotationKeyValue(eventmesh_opts)
      })
      .catch(err => {
        return Promise
          .try(() => logger.error(`Error during start of backup - backup to be aborted : ${backupStarted} - backup to be deleted: ${metaUpdated} `, err))
          .tap(() => eventmesh.server.updateAnnotationState({
            resourceId: opts.instance_guid,
            annotationName: 'backup',
            annotationType: 'default',
            annotationId: result.backup_guid,
            stateValue: 'error'
          }))
          .tap((res) => eventmesh.server.updateAnnotationKey({
            resourceId: opts.instance_guid,
            annotationName: 'backup',
            annotationType: 'default',
            annotationId: result.backup_guid,
            key: 'result',
            value: JSON.stringify(err, null, 2)
          }))
          .tap(() => {
            if (backupStarted) {
              logger.error(`Error occurred during backup process. Aborting backup on deployment : ${deploymentName}`);
              return this
                .abortLastBackup(this.getTenantGuid(opts.context), opts.instance_guid, true)
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

  getBackupOperationState(opts) {
    const agent_ip = opts.agent_ip;
    const options = _.assign({
      service_id: this.service.id,
      // plan_id: this.plan.id,
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

  getLastBackup(tenant_id, instance_guid, noCache) {
    return this.backupStore
      .getBackupFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
        // plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .then(metadata => {
        switch (metadata.state) {
        case 'processing':
          return noCache ? this.agent
            .getBackupLastOperation(metadata.agent_ip)
            .then(data => _.assign(metadata, _.pick(data, 'state', 'stage'))) : metadata;
        default:
          return metadata;
        }
      });
  }

  abortLastBackup(tenant_id, instance_guid, force) {
    logger.info('Aborting last backup', tenant_id, instance_guid);
    return this.backupStore
      .getBackupFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
        // plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .tap(metadata => {
        return eventmesh.server.updateAnnotationState({
          resourceId: instance_guid,
          annotationName: 'backup',
          annotationType: 'default',
          annotationId: metadata.backup_guid,
          stateValue: 'aborting'
        })
      })
      .then(metadata => {
        if (!force && metadata.trigger === CONST.BACKUP.TRIGGER.SCHEDULED) {
          throw new Forbidden('System scheduled backup runs cannot be aborted');
        }
        logger.info('metadata.state', metadata.state);
        switch (metadata.state) {
        case 'processing':
          return this.agent
            .abortBackup(metadata.agent_ip)
            .return({
              state: 'aborting'
            });
        default:
          return _.pick(metadata, 'state');
        }
      });
  }

  static get prefix() {
    return _
      .reduce(config.directors,
        (prefix, director) => director.primary === true ? director.prefix : prefix,
        null) || super.prefix;
  }

}

class Fabrik {
  static createManager(plan) {
    return Promise
      .try(() => {
        return BackupManager;
      })
      .then(managerConstructor => managerConstructor.load(plan));
  }

}
Fabrik.BackupManager = BackupManager;
module.exports = Fabrik;