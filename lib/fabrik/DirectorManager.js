'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../config');
const logger = require('../logger');
const errors = require('../errors');
const bosh = require('../bosh');
const cf = require('../cf');
const backupStore = require('../iaas').backupStore;
const utils = require('../utils');
const Agent = require('./Agent');
const BaseManager = require('./BaseManager');
const DirectorInstance = require('./DirectorInstance');
const CONST = require('../constants');
const ActionManager = require('./actions/ActionManager');
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
const FeatureNotSupportedByAnyAgent = errors.FeatureNotSupportedByAnyAgent;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const Forbidden = errors.Forbidden;
const catalog = require('../models/catalog');

class DirectorManager extends BaseManager {
  constructor(plan) {
    super(plan);
    this.director = bosh.director;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
  }

  isAutoUpdatePossible() {
    return true;
  }

  get template() {
    return new Buffer(this.settings.template, 'base64').toString('utf8');
  }

  get stemcell() {
    return _(this.settings)
      .chain()
      .get('stemcell', {})
      .defaults(BoshDirectorClient.getInfrastructure().stemcell)
      .update('version', version => '' + version)
      .value();
  }

  get releases() {
    return _(this.settings)
      .chain()
      .get('releases')
      .map(release => _.pick(release, 'name', 'version'))
      .sortBy(release => `${release.name}/${release.version}`)
      .value();
  }

  get networkName() {
    return this.subnet || BoshDirectorClient.getInfrastructure().segmentation.network_name || 'default';
  }

  get resourcePools() {
    const networkName = this.networkName;
    const stemcell = this.stemcell;
    return _.reduce(BoshDirectorClient.getInfrastructure().azs, (result, az) => {
      _.forEach(BoshDirectorClient.getInfrastructure().vm_types, vm_type => {
        result.push({
          name: `${vm_type.name}_${az.name}`,
          network: `${networkName}_${az.name}`,
          stemcell: stemcell,
          cloud_properties: _.assign({}, az.cloud_properties, vm_type.cloud_properties)
        });
      });
      return result;
    }, []);
  }

  getDeploymentName(guid, networkSegmentIndex) {
    let subnet = this.subnet ? `_${this.subnet}` : '';
    return `${DirectorManager.prefix}${subnet}-${NetworkSegmentIndex.adjust(networkSegmentIndex)}-${guid}`;
  }

  getNetworkSegmentIndex(deploymentName) {
    return _.nth(DirectorManager.parseDeploymentName(deploymentName, this.subnet), 1);
  }

  getInstanceGuid(deploymentName) {
    return _.nth(DirectorManager.parseDeploymentName(deploymentName, this.subnet), 2);
  }

  getNetworks(index) {
    return new Networks(BoshDirectorClient.getInfrastructure().networks, index, BoshDirectorClient.getInfrastructure().segmentation);
  }

  getNetwork(index) {
    return this.getNetworks(index)[this.networkName];
  }

  aquireNetworkSegmentIndex(guid) {
    logger.info(`Aquiring network segment index for a new deployment with instance id '${guid}'...`);
    return this.getDeploymentNames(true)
      .then(deploymentNames => {
        const deploymentName = _.find(deploymentNames, name => _.endsWith(name, guid));
        if (deploymentName) {
          logger.warn('+-> Deployment with this instance id already exists');
          throw new ServiceInstanceAlreadyExists(guid);
        }
        return NetworkSegmentIndex.findFreeIndex(deploymentNames, this.subnet);
      })
      .tap(networkSegmentIndex => logger.info(`+-> Aquired network segment index '${networkSegmentIndex}'`));
  }

  findDeploymentNameByInstanceId(guid) {
    logger.info(`Finding deployment name with instance id : '${guid}'`);
    return this.getDeploymentNames(false)
      .then(deploymentNames => {
        const deploymentName = _.find(deploymentNames, name => _.endsWith(name, guid));
        if (!deploymentName) {
          logger.warn(`+-> Could not find a matching deployment for guid: ${guid}`);
          throw new ServiceInstanceNotFound(guid);
        }
        return deploymentName;
      })
      .tap(deploymentName => logger.info(`+-> Found deployment '${deploymentName}' for '${guid}'`));
  }

  findNetworkSegmentIndex(guid) {
    logger.info(`Finding network segment index of an existing deployment with instance id '${guid}'...`);
    return this
      .director
      .getDeploymentNameForInstanceId(guid)
      .then(deploymentName => this.getNetworkSegmentIndex(deploymentName))
      .tap(networkSegmentIndex => logger.info(`+-> Found network segment index '${networkSegmentIndex}'`));
  }

  getDeploymentNames(queued) {
    return this.director.getDeploymentNames(queued);
  }

  getTask(taskId) {
    logger.info(`Fetching task '${taskId}'...`);
    return this.director
      .getTask(taskId)
      .tap(task => logger.info(`+-> Fetched task for deployment '${task.deployment}' has state '${task.state}'`))
      .catch(err => {
        logger.error('+-> Failed to fetch task');
        logger.error(err);
        throw err;
      });
  }

  getDeploymentManifest(deploymentName) {
    logger.info(`Fetching deployment manifest '${deploymentName}'...`);
    return this.director
      .getDeploymentManifest(deploymentName)
      .tap(() => logger.info('+-> Fetched deployment manifest'))
      .catch(err => {
        logger.error('+-> Failed to fetch deployment manifest');
        logger.error(err);
        throw err;
      });
  }

  getDeploymentIps(deploymentName) {
    return this.director.getDeploymentIps(deploymentName);
  }

  createOrUpdateDeployment(deploymentName, params, args) {
    const previousValues = _.get(params, 'previous_values');
    const action = _.isPlainObject(previousValues) ? CONST.OPERATION_TYPE.UPDATE : CONST.OPERATION_TYPE.CREATE;
    const opts = _.omit(params, 'previous_values');
    args = args || {};
    args = _.set(args, 'bosh_director_name', _.get(params, 'parameters.bosh_director_name'));
    const username = _.get(params, 'parameters.username');
    const password = _.get(params, 'parameters.password');
    logger.info(`Starting to ${action} deployment '${deploymentName}'...`);
    let serviceLifeCycle;
    let actionContext = {};
    _.chain(actionContext)
      .set('params', params)
      .set('deployment_name', deploymentName)
      .set('sf_operations_args', args)
      .value();

    return Promise
      .try(() => {
        switch (action) {
        case CONST.OPERATION_TYPE.UPDATE:
          serviceLifeCycle = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
          if (_.get(params, 'parameters.bosh_director_name') ||
            username || password) {
            throw new BadRequest(`Update cannot be done on custom BOSH`);
          }
          return this
            .getDeploymentManifest(deploymentName)
            .then(manifest => {
              _.assign(actionContext.params, {
                'previous_manifest': manifest
              });
              _.assign(opts, {
                previous_manifest: manifest
              }, opts.context);
              return;
            });
        case CONST.OPERATION_TYPE.CREATE:
          serviceLifeCycle = CONST.SERVICE_LIFE_CYCLE.PRE_CREATE;
          if (_.get(params, 'parameters.bosh_director_name')) {
            return cf
              .uaa
              .getScope(username, password)
              .then(scopes => {
                const isAdmin = _.includes(scopes, 'cloud_controller.admin');
                if (!isAdmin) {
                  throw new errors.Forbidden('Token has insufficient scope');
                }
              });
          }
          return;
        }
      })
      .then(() => this.executeActions(serviceLifeCycle, actionContext))
      .then((preDeployResponse) => this.generateManifest(deploymentName, opts, preDeployResponse))
      .tap(manifest => logger.info('+-> Deployment manifest:\n', manifest))
      .then(manifest => this.director.createOrUpdateDeployment(action, manifest, args))
      .tap(taskId => logger.info(`+-> Scheduled ${action} deployment task '${taskId}'`))
      .catch(err => {
        logger.error(`+-> Failed to ${action} deployment`);
        logger.error(err);
        throw err;
      });
  }

  executeActions(phase, context) {
    return Promise.try(() => {
      const serviceLevelActions = this.service.actions;
      const planLevelActions = phase === CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE ? catalog.getPlan(context.params.previous_values.plan_id).actions :
        this.plan.actions;
      if (serviceLevelActions || planLevelActions) {
        const cumilativeActions = serviceLevelActions ? (planLevelActions ? `${serviceLevelActions},${planLevelActions}` : serviceLevelActions) :
          planLevelActions;
        const actionsToPerform = _.chain(cumilativeActions)
          .replace(/\s*/g, '')
          .split(',')
          .value();
        if (actionsToPerform.length === 0) {
          logger.info(`no actions to perform for ${context.deployment_name}`);
          return {};
        }
        logger.info(`actionsToPerform - @service - ${serviceLevelActions} , @plan - ${planLevelActions}`);
        logger.info(`Cumulative actions to perform on ${context.deployment_name} - ${actionsToPerform}`);
        const actionResponse = {};
        let actionStartTime = Date.now();
        let actionEndTime;
        return Promise.map(actionsToPerform, (action) => {
            logger.debug(`Looking up action ${action}`);
            const actionHandler = ActionManager.getAction(phase, action);
            _.assign(context, {
              'instance_guid': this.getInstanceGuid(context.deployment_name)
            });
            _.chain(context.params)
              .set('service_id', this.service.id)
              .set('plan_id', this.plan.id)
              .value();
            return actionHandler(context)
              .tap(resp => actionResponse[action] = resp);
          })
          .tap(() => logger.info(`${phase} response ...`, actionResponse))
          .tap(() => {
            actionEndTime = Date.now();
            if (actionEndTime - actionStartTime > config.deployment_action_timeout) {
              throw new errors.InternalServerError(`Action scripts timed out`);
            }
          })
          .return(actionResponse);
      } else {
        logger.info(`No actions to perform for ${context.deployment_name}`);
        return {};
      }
    });
  }

  deleteDeployment(deploymentName) {
    logger.info(`Deleting deployment '${deploymentName}'...`);
    let actionContext = {
      'deployment_name': deploymentName
    };
    return this.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_DELETE, actionContext)
      .then(() => {
        if (_.includes(this.agent.features, 'lifecycle')) {
          return this
            .getDeploymentIps(deploymentName)
            .then(ips => this.agent.deprovision(ips))
            .catch(FeatureNotSupportedByAnyAgent, ServiceInstanceNotOperational, err => {
              logger.debug('+-> Catched expected error of feature \'deprovision\':', err);
              return;
            });
        }
      })
      .then(() => this.director.deleteDeployment(deploymentName))
      .tap(taskId => logger.info(`+-> Scheduled delete deployment task '${taskId}'`))
      .catch(err => {
        logger.error('+-> Failed to delete deployment');
        logger.error(err);
        throw err;
      });
  }

  createBinding(deploymentName, binding) {
    this.verifyFeatureSupport('credentials');
    logger.info(`Creating binding '${binding.id}' for deployment '${deploymentName}'...`);
    logger.info('+-> Binding parameters:', binding.parameters);
    let actionContext = {
      'deployment_name': deploymentName
    };
    _.assign(actionContext, binding);
    return this.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_BIND, actionContext)
      .then(() => this.getDeploymentIps(deploymentName))
      .then(ips => this.agent.createCredentials(ips, binding.parameters))
      .tap(credentials => this.createBindingProperty(deploymentName, binding.id, _.set(binding, 'credentials', credentials)))
      .tap(() => {
        const bindCreds = _.cloneDeep(binding.credentials);
        utils.maskSensitiveInfo(bindCreds);
        logger.info(`+-> Created binding:${JSON.stringify(bindCreds)}`);
      })
      .catch(err => {
        logger.error('+-> Failed to create binding');
        logger.error(err);
        throw err;
      });
  }

  deleteBinding(deploymentName, id) {
    this.verifyFeatureSupport('credentials');
    logger.info(`Deleting binding '${id}' for deployment '${deploymentName}'...`);
    let actionContext = {
      'deployment_name': deploymentName,
      'id': id
    };
    return this.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_UNBIND, actionContext)
      .then(() =>
        Promise
        .all([
          this.getDeploymentIps(deploymentName),
          this.getBindingProperty(deploymentName, id)
        ]))
      .spread((ips, binding) => this.agent.deleteCredentials(ips, binding.credentials))
      .then(() => this.deleteBindingProperty(deploymentName, id))
      .tap(() => logger.info('+-> Deleted service binding'))
      .catch(err => {
        logger.error('+-> Failed to delete binding');
        logger.error(err);
        throw err;
      });
  }

  getBindingProperty(deploymentName, id) {
    return this.director
      .getDeploymentProperty(deploymentName, `binding-${id}`)
      .then(result => JSON.parse(result))
      .catchThrow(NotFound, new ServiceBindingNotFound(id));
  }

  createBindingProperty(deploymentName, id, value) {
    return this.director
      .createDeploymentProperty(deploymentName, `binding-${id}`, JSON.stringify(value))
      .catchThrow(BadRequest, new ServiceBindingAlreadyExists(id));
  }

  deleteBindingProperty(deploymentName, id) {
    return this.director
      .deleteDeploymentProperty(deploymentName, `binding-${id}`);
  }

  diffManifest(deploymentName, opts) {
    logger.debug(`+-> Checking diff of deployment ${deploymentName}`);
    return this
      .regenerateManifest(deploymentName, opts)
      .then(manifest => this.director
        .diffDeploymentManifest(deploymentName, manifest)
        .then(result => _.set(result, 'manifest', manifest))
      );
  }

  regenerateManifest(deploymentName, opts) {
    return this.director
      .getDeploymentManifest(deploymentName)
      .then(manifest => this.generateManifest(deploymentName, _.extend(opts, {
        previous_manifest: manifest
      })));
  }

  generateManifest(deploymentName, opts, preDeployResponse) {
    const index = opts.network_index || this.getNetworkSegmentIndex(deploymentName);
    const networks = this.getNetworks(index);
    const allRequiredNetworks = _.union(networks.dynamic, networks.all.filter(net => _.startsWith(net.name, this.networkName)));
    const tags = opts.context;
    const header = new Header({
      name: deploymentName,
      director_uuid: this.director.uuid,
      releases: this.releases,
      stemcells: [this.stemcell],
      tags: tags,
      networks: _.map(allRequiredNetworks, net => net.toJSON())
    });
    const context = new EvaluationContext(_.assign({
      index: index,
      header: header,
      cpi: this.director.cpi,
      networks: networks[this.networkName],
      parameters: opts.parameters || {},
      properties: this.settings.context || {},
      previous_manifest: opts.previous_manifest,
      multi_az_enabled: config.multi_az_enabled,
      stemcell: this.stemcell,
      actions: preDeployResponse
    }, opts.context));
    logger.info('Predeploy response -', preDeployResponse);
    if (networks[this.networkName] === undefined) {
      logger.error(`subnet ${this.networkName} definition not found among the applicable networks defintion : ${JSON.stringify(networks)}`);
      throw new errors.UnprocessableEntity(`subnet ${this.networkName} definition not found`);
    }
    return _.template(this.template)(context);
  }

  findDeploymentTask(deploymentName) {
    return this.director
      .getTasks({
        deployment: deploymentName
      })
      .then(tasks => _
        .chain(tasks)
        .sortBy('id')
        .find(task => /^create\s+deployment/.test(task.description))
        .value()
      );
  }

  getDeploymentInfo(deploymentName) {
    const events = {};
    const info = {};

    function DeploymentDoesNotExist(err) {
      return err.status === 404 && _.get(err, 'error.code') === 70000;
    }

    function addInfoEvent(event) {
      if (!_.has(events, event.stage)) {
        events[event.stage] = {
          tags: event.tags,
          total: event.total,
        };
      }
      if (!_.has(events[event.stage], event.task)) {
        events[event.stage][event.task] = {
          index: event.index,
          time: event.time,
          status: event.state
        };
      } else {
        events[event.stage][event.task].status = event.state;
        let seconds = event.time - events[event.stage][event.task].time;
        delete events[event.stage][event.task].time;
        events[event.stage][event.task].duration = `${seconds} sec`;
      }
    }

    return this
      .findDeploymentTask(deploymentName)
      .tap(task => _.assign(info, task))
      .then(task => this.director.getTaskEvents(task.id))
      .tap(events => _.each(events, addInfoEvent))
      .return(_.set(info, 'events', events))
      .catchReturn(DeploymentDoesNotExist, null);
  }

  invokeServiceFabrikOperation(name, opts) {
    logger.info(`Invoking service fabrik operation '${name}' with:`, opts);
    switch (name) {
    case CONST.OPERATION_TYPE.BACKUP:
      return this.startBackup(opts);
    case CONST.OPERATION_TYPE.RESTORE:
      return this.startRestore(opts);
    case CONST.OPERATION_TYPE.UNLOCK:
      return this.unlock(opts);
    }
    throw new BadRequest(`Invalid service fabrik operation '${name}'`);
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

  getServiceInstanceState(instanceGuid) {
    return this
      .findNetworkSegmentIndex(instanceGuid)
      .then(networkSegmentIndex => this.getDeploymentName(instanceGuid, networkSegmentIndex))
      .then(deploymentName => this.getDeploymentIps(deploymentName))
      .then(ips => this.agent.getState(ips));
  }

  getLockProperty(deploymentName) {
    return this.director.getLockProperty(deploymentName);
  }

  verifyDeploymentLockStatus(deploymentName) {
    return this
      .getLockProperty(deploymentName)
      .then(lockInfo => {
        if (!lockInfo) {
          return;
        }
        throw new errors.DeploymentAlreadyLocked(deploymentName, lockInfo);
      });
  }

  releaseLock(deploymentName) {
    return this.director
      .deleteDeploymentProperty(deploymentName, CONST.DEPLOYMENT_LOCK_NAME);
  }

  acquireLock(deploymentName, lockMetaInfo) {
    return Promise
      .try(() => {
        if (!_.get(lockMetaInfo, 'username') || !_.get(lockMetaInfo, 'lockForOperation')) {
          const msg = `Lock cannot be acquired on deployment ${deploymentName} as (username | lockForOperation) is empty in lockMetaInfo`;
          logger.error(msg, lockMetaInfo);
          throw new errors.BadRequest(msg);
        }
        if (!_.get(lockMetaInfo, 'createdAt')) {
          _.set(lockMetaInfo, 'createdAt', new Date());
        }
        logger.info(`Acquiring lock on deployment ${deploymentName} - lock meta : ${JSON.stringify(lockMetaInfo)}`);
        return this.director
          .updateOrCreateDeploymentProperty(deploymentName, CONST.DEPLOYMENT_LOCK_NAME, JSON.stringify(lockMetaInfo));
      });
  }

  unlock(opts) {
    const responseMessage = _.get(opts, 'arguments.description') || `Unlocked deployment ${opts.deployment}`;
    const response = {
      description: responseMessage
    };
    return this
      .releaseLock(opts.deployment)
      .then(() => response)
      .catch((errors.NotFound), () => {
        logger.info(`Lock already released from deployment - ${opts.deployment}`);
        return response;
      });
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

    const lockInfo = {
      username: data.username,
      lockForOperation: `${data.trigger}_${data.operation}`
    };
    let lockAcquired = false,
      metaUpdated = false,
      backupStarted = false;

    return Promise
      .all([
        createSecret(),
        this.getDeploymentIps(deploymentName),
        this.director.getDeploymentVms(deploymentName).map(normalizeVm)
      ])
      .spread((secret, ips, vms) => {
        // set data and backup secret
        data.secret = backup.secret = secret;
        return this.agent
          .startBackup(ips, backup, vms)
          .then(agent_ip => {
            backupStarted = true;
            // set data and result agent ip
            data.agent_ip = result.agent_ip = agent_ip;
            return this.backupStore.putFile(data);
          })
          .then(() => {
            metaUpdated = true;
            const instanceInfo = _.chain(data)
              .pick('tenant_id', 'backup_guid', 'instance_guid', 'agent_ip', 'service_id', 'plan_id')
              .set('deployment', deploymentName)
              .set('started_at', backupStartedAt)
              .value();
            return this
              .acquireLock(deploymentName,
                _.set(lockInfo, 'instanceInfo', instanceInfo))
              .then(() => lockAcquired = true);
            //Since this execution flow is already in CF update acquiring the lock post successful start of backup.
            //We are creating another lock (on the deployment) & releasing the CF Lock for update operation by making the response for backup as SYNCH.
            //NOTE: This flow of code must be excplicitly invoked via CF update ONLY. (for ex. this cannot be invoked by OOB backup)
          });
      })
      .return(result)
      .catch(err => {
        return Promise
          .try(() => logger.error(`Error during start of backup - backup to be aborted : ${backupStarted} - backup to be deleted: ${metaUpdated}`, err))
          .tap(() => {
            if (backupStarted) {
              logger.error(`Error occurred during backup process. Aborting backup on deployment : ${deploymentName}`);
              return this
                .abortLastBackup(this.getTenantGuid(data.context), data.instance_guid, true)
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

  getLastBackup(tenant_id, instance_guid, noCache) {
    return this.backupStore
      .getBackupFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
        plan_id: this.plan.id,
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
    return this.backupStore
      .getBackupFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
        plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .then(metadata => {
        if (!force && metadata.trigger === CONST.BACKUP.TRIGGER.SCHEDULED) {
          throw new Forbidden('System scheduled backup runs cannot be aborted');
        }
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

  startRestore(opts) {
    const deploymentName = opts.deployment;
    const args = opts.arguments;
    const backupMetadata = args.backup;

    const backup = {
      guid: args.backup_guid,
      timeStamp: args.time_stamp,
      type: backupMetadata.type,
      secret: backupMetadata.secret,
      snapshotId: backupMetadata.snapshotId
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
          return this.backupStore.putFile(data);
        })
      )
      .return(result);
  }

  getRestoreOperationState(opts) {
    const agent_ip = opts.agent_ip;
    const options = _.assign({
      service_id: this.service.id,
      plan_id: this.plan.id,
      tenant_id: opts.context ? this.getTenantGuid(opts.context) : opts.tenant_id
    }, opts);

    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }

    return this.agent
      .getRestoreLastOperation(agent_ip)
      .tap(lastOperation => {
        if (isFinished(lastOperation.state)) {
          return this.agent
            .getRestoreLogs(agent_ip)
            .then(logs => this.backupStore
              .patchRestoreFile(options, {
                state: lastOperation.state,
                logs: logs
              })
            );
        }
      });
  }

  getLastRestore(tenant_id, instance_guid) {
    return this.backupStore
      .getRestoreFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
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

  abortLastRestore(tenant_id, instance_guid) {
    return this.backupStore
      .getRestoreFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
        plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .then(metadata => {
        switch (metadata.state) {
        case 'processing':
          return this.agent
            .abortRestore(metadata.agent_ip)
            .return({
              state: 'aborting'
            });
        default:
          return _.pick(metadata, 'state');
        }
      });
  }

  deleteRestoreFile(tenant_id, instance_guid) {
    const options = {
      tenant_id: tenant_id,
      service_id: this.service.id,
      plan_id: this.plan.id,
      instance_guid: instance_guid
    };
    return Promise.try(() => {
      if (!_.includes(this.agent.features, 'backup')) {
        return null;
      } else {
        return this.backupStore.deleteRestoreFile(options);
      }

    });
  }

  verifyFeatureSupport(feature) {
    if (!_.includes(this.agent.features, feature)) {
      throw new NotImplemented(`Feature '${feature}' not supported`);
    }
  }

  static get prefix() {
    return _
      .reduce(config.directors,
        (prefix, director) => director.primary === true ? director.prefix : prefix,
        null) || super.prefix;
  }

  static get instanceConstructor() {
    return DirectorInstance;
  }

  static parseDeploymentName(deploymentName, subnet) {
    return _
      .chain(utils.deploymentNameRegExp(subnet).exec(deploymentName))
      .slice(1)
      .tap(parts => parts[1] = parts.length ? parseInt(parts[1]) : undefined)
      .value();
  }
}

module.exports = DirectorManager;