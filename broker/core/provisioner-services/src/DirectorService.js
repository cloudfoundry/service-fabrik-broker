'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const selfSigned = require('selfsigned');

const config = require('@sf/app-config');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    NotFound,
    ServiceInstanceNotFound,
    ServiceInstanceAlreadyExists,
    DirectorServiceUnavailable,
    FeatureNotSupportedByAnyAgent,
    ServiceInstanceNotOperational,
    DeploymentDelayed,
    Forbidden,
    Timeout,
    UnprocessableEntity,
    BadRequest,
    DeploymentAttemptRejected
  },
  commonFunctions: {
    verifyFeatureSupport,
    retry,
    maskSensitiveInfo,
    decodeBase64,
    isFeatureEnabled
    
  }
} = require('@sf/common-utils');
const { getPlatformManager } = require('@sf/platforms');
const { catalog } = require('@sf/models');

const ScheduleManager = require('@sf/jobs');

const {
  manifest: {
    Header,
    Addons
  },
  EvaluationContext,
  NetworkSegmentIndex,
  director
} = require('@sf/bosh');
const { apiServerClient } = require('@sf/eventmesh');
const Agent = require('@sf/service-agent');
const { backupStore } = require('@sf/iaas');
const BaseDirectorService = require('./BaseDirectorService');
const {
  cloudController,
  serviceFabrikClient,
  uaa
} = require('@sf/cf');

class DirectorService extends BaseDirectorService {
  constructor(plan, guid) {
    super(plan);
    this.guid = guid;
    this.plan = plan;
    this.cloudController = cloudController;
    this.serviceFabrikClient = serviceFabrikClient;
    this.director = director;
    this.networkSegmentIndex = undefined;
    this.platformManager = undefined;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
    this.prefix = CONST.SERVICE_FABRIK_PREFIX;
  }

  assignPlatformManager(platformManager) {
    this.platformManager = platformManager;
  }

  get platformContext() {
    return this.getContextFromResource()
      .then(context => {
        if (_.isEmpty(context)) {
          context = {
            platform: CONST.PLATFORM.CF
          };
        } 
        return context;
      });
  }

  getDeploymentName(guid, networkSegmentIndex) {
    let subnet = this.subnet ? `_${this.subnet}` : '';
    return `${this.prefix}${subnet}-${NetworkSegmentIndex.adjust(networkSegmentIndex)}-${guid}`;
  }

  getServiceInstanceState(instanceGuid) {
    return this
      .findNetworkSegmentIndex(instanceGuid)
      .then(networkSegmentIndex => this.getDeploymentName(instanceGuid, networkSegmentIndex))
      .then(deploymentName => this.getDeploymentIps(deploymentName))
      .then(ips => this.agent.getState(ips));
  }


  static get prefix() {
    return _
      .reduce(config.directors,
        (prefix, director) => director.primary === true ? director.prefix : prefix,
        null) || super.prefix;
  }

  get deploymentName() {
    let subnet = this.subnet ? `_${this.subnet}` : '';
    return `${this.prefix}${subnet}-${NetworkSegmentIndex.adjust(this.networkSegmentIndex)}-${this.guid}`;
  }

  getContextFromResource() {
    logger.debug(`Fetching context from etcd for ${this.guid}`);
    return apiServerClient.getPlatformContext({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      resourceId: this.guid
    })
      .catch(err => {
        logger.error(`Error occured while getting context from resource for instance ${this.guid} `, err);
        return;
      });
  }

  getNetworkSegmentIndex(deploymentName) {
    return _.nth(BaseDirectorService.parseDeploymentName(deploymentName, this.subnet), 1);
  }

  getInstanceGuid(deploymentName) {
    return _.nth(BaseDirectorService.parseDeploymentName(deploymentName, this.subnet), 2);
  }

  initialize(operation, deploymentName) {
    return Promise
      .try(() => {
        this.operation = operation.type;
        if (deploymentName) {
          return this.getNetworkSegmentIndex(deploymentName);
        }
        if (operation.type === CONST.OPERATION_TYPE.CREATE) {
          return this.acquireNetworkSegmentIndex(this.guid);
        }
        return this.findNetworkSegmentIndex(this.guid);
      })
      .then(networkSegmentIndex => {
        assert.ok(_.isInteger(networkSegmentIndex), `Network segment index '${networkSegmentIndex}' must be an integer`);
        this.networkSegmentIndex = networkSegmentIndex;
        return networkSegmentIndex;
      })
      .tap(() => {
        if (!deploymentName && operation.type === 'delete') {
          return Promise
            .all([
              this.platformManager.preInstanceDeleteOperations({
                guid: this.guid
              }),
              this.deleteRestoreFile() // This should be revisited when broker start supporting K8s through service manager
            ]);
        }
      });
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

  acquireNetworkSegmentIndex(guid) {
    logger.debug(`Acquiring network segment index for a new deployment with instance id '${guid}'...`);
    const promises = [this.getDeploymentNames(true)];
    if (config.enable_bosh_rate_limit) {
      promises.push(this.getDeploymentNamesInCache());
    }
    return Promise.all(promises)
      .then(deploymentNameCollection =>
        _.chain(deploymentNameCollection)
          .flatten()
          .uniq()
          .value()
      )
      .then(deploymentNames => {
        const deploymentName = _.find(deploymentNames, name => _.endsWith(name, guid));
        if (deploymentName) {
          logger.warn('+-> Deployment with this instance id already exists');
          throw new ServiceInstanceAlreadyExists(guid);
        }
        return NetworkSegmentIndex.findFreeIndex(deploymentNames, this.subnet);
      })
      .tap(networkSegmentIndex => logger.info(`+-> Acquired network segment index '${networkSegmentIndex}'`));
  }

  deleteRestoreFile() {
    if (_.includes(this.agent.features, 'backup')) {
      return Promise.try(() => this.platformManager.ensureTenantId({
        context: this.platformContext,
        guid: this.guid
      }))
        .then(tenant_id => tenant_id ? this.deleteRestoreFileFromObjectStore(tenant_id, this.guid) : Promise.resolve({}))
        .catch(err => {
          logger.error(`Failed to delete restore file of instance '${this.guid}'`, err);
          err.statusCode = CONST.ERR_STATUS_CODES.STORE.DEFAULT;
          throw err;
        });
    }
  }

  deleteRestoreFileFromObjectStore(tenant_id, instance_guid) {
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

  finalize(operation) {
    const action = _.capitalize(operation.type);
    return Promise
      .try(() => {
        switch (operation.type) {
          case 'create':
            return Promise.try(() => this.platformManager.postInstanceProvisionOperations({
              ipRuleOptions: this.buildIpRules(),
              guid: this.guid,
              context: operation.context
            }))
              .tap(() => operation.state === CONST.OPERATION.SUCCEEDED ? this.scheduleAutoUpdate() : {});

          case 'update':
            return this.platformManager.postInstanceUpdateOperations({
              ipRuleOptions: this.buildIpRules(),
              guid: this.guid,
              context: operation.context
            });
        }
      })
      .catch(err => _.assign(operation, {
        state: CONST.APISERVER.RESOURCE_STATE.FAILED,
        resourceState: CONST.APISERVER.RESOURCE_STATE.FAILED,
        deployment: this.deploymentName,
        description: `${action} deployment '${this.deploymentName}' not yet completely succeeded because "${err.message}"`
      }));
  }

  create(params, deploymentName) {
    const operation = {
      type: 'create'
    };
    return this
      .initialize(operation, deploymentName)
      .then(() => {
        if (_.isInteger(this.networkSegmentIndex)) {
          return this.createOrUpdateDeployment(this.deploymentName, params);
        }
      })
      .catch(DirectorServiceUnavailable, err =>
        logger.warn(`Error occurred while creating deployment for instance guid :${this.guid}`, err))
      .then(op => _
        .chain(operation)
        .assign(_.pick(params, 'parameters', 'context'))
        .set('task_id', _.get(op, 'task_id'))
        .set('deployment_name', _.isInteger(this.networkSegmentIndex) ? this.deploymentName : undefined)
        .value()
      );
  }

  update(params, deploymentName) {
    const operation = {
      type: 'update'
    };
    return this
      .initialize(operation, deploymentName)
      .then(() => {
        logger.info('Parameters for update operation:', _.get(params, 'parameters'));
        this.operation = this.operation || 'update';
        if (_.isInteger(this.networkSegmentIndex)) {
          return this.createOrUpdateDeployment(this.deploymentName, params);
        }
      })
      .catch(DirectorServiceUnavailable, err =>
        logger.error(`Error occurred while updating deployment for instance guid :${this.guid}`, err))
      .then(op => _
        .chain(operation)
        .assign(_.pick(params, 'parameters', 'context'))
        .set('task_id', _.get(op, 'task_id'))
        .set('deployment_name', _.isInteger(this.networkSegmentIndex) ? this.deploymentName : undefined)
        .value()
      );
  }

  findNetworkSegmentIndex(guid) {
    logger.debug(`Finding network segment index of an existing deployment with instance id '${guid}'...`);
    return this
      .director
      .getDeploymentNameForInstanceId(guid)
      .then(deploymentName => this.getNetworkSegmentIndex(deploymentName))
      .tap(networkSegmentIndex => logger.info(`+-> Found network segment index '${networkSegmentIndex}'`));
  }

  getDeploymentNames(queued) {
    return this.director.getDeploymentNames(queued);
  }

  getDeploymentNamesInCache() {
    return apiServerClient.getResourceListByState({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      stateList: [CONST.APISERVER.RESOURCE_STATE.WAITING]
    })
      .map(resource => _.get(resource, 'status.response.deployment_name'))
      .then(deploymentNames => _
        .chain(deploymentNames)
        .flatten()
        .compact()
        .uniq()
        .value()
      );
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

  executePolicy(scheduled, action, deploymentName) {
    const runOutput = {
      'shouldRunNow': false
    };
    let targetDirectorConfig;
    return this.director.getDirectorForOperation(action, deploymentName)
      .then(directorConfig => {
        targetDirectorConfig = directorConfig;
        return this.director.getCurrentTasks(action, targetDirectorConfig);
      })
      .then(tasksCount => {
        let currentTasks, maxWorkers;
        const allTasks = tasksCount.total;
        const maxTasks = _.get(targetDirectorConfig, 'max_workers', 6);
        if (allTasks >= maxTasks) {
          // no slots left anyway
          runOutput.shouldRunNow = false;
          return runOutput;
        }
        if (scheduled) {
          currentTasks = tasksCount.scheduled;
          maxWorkers = _.get(targetDirectorConfig, 'policies.scheduled.max_workers', 3);
        } else {
          currentTasks = tasksCount[action];
          maxWorkers = _.get(targetDirectorConfig, `policies.user.${action}.max_workers`, 3);
        }
        if (currentTasks < maxWorkers) {
          // should run if the tasks count is lesser than the specified max workers for op type
          runOutput.shouldRunNow = true;
          return runOutput;
        }
        return runOutput;
      }).catch(err => {
        logger.error('Error connecting to BOSH director > could not fetch current tasks', err);
        // in case the director request returns an error, we queue it to avoid user experience issues
        // return with shouldRunNow = false so that it is taken care of in processing
        return runOutput;
      });
  }

  createOrUpdateDeployment(deploymentName, params, args) {
    logger.info('Checking rate limits against bosh for deployment ');
    const previousValues = _.get(params, 'previous_values');
    const action = _.isPlainObject(previousValues) ? CONST.OPERATION_TYPE.UPDATE : CONST.OPERATION_TYPE.CREATE;
    const scheduled = _.get(params, 'parameters.scheduled') || false;
    const runImmediately = _.get(params, 'parameters._runImmediately') || false;
    _.omit(params, 'parameters.scheduled');
    _.omit(params, 'parameters._runImmediately');

    if (!config.enable_bosh_rate_limit || runImmediately) {
      return this._createOrUpdateDeployment(deploymentName, params, args, scheduled)
        .then(taskId => {
          return {
            task_id: taskId
          };
        });
    }
    return this
      .executePolicy(scheduled, action, deploymentName)
      .then(res => {
        if (scheduled && !res.shouldRunNow) {
          throw new DeploymentAttemptRejected(deploymentName);
        }
        if (!res.shouldRunNow) {
          // deployment stagger
          throw new DeploymentDelayed(deploymentName);
        } else {
          // process the deployment
          return this._createOrUpdateDeployment(deploymentName, params, args, scheduled);
        }
      })
      .then(taskId => {
        return {
          task_id: taskId
        };
      })
      .catch(DeploymentDelayed, e => {
        logger.info(`Deployment ${deploymentName} delayed- this should be picked up later for processing`, e);
        return {
          task_id: undefined
        };
      })
      .catch(err => {
        logger.error(`Error in deployment for ${deploymentName}`, err);
        throw err;
      });
  }

  _createOrUpdateDeployment(deploymentName, params, args, scheduled) {
    const previousValues = _.get(params, 'previous_values');
    const action = _.isPlainObject(previousValues) ? CONST.OPERATION_TYPE.UPDATE : CONST.OPERATION_TYPE.CREATE;
    const opts = _.omit(params, 'previous_values');
    args = args || {};
    args = _.set(args, 'bosh_director_name', _.get(params, 'parameters.bosh_director_name'));
    if (action == CONST.OPERATION_TYPE.CREATE) {
      if (_.has(this.plan, 'manager.settings.canaries')) {
        _.set(args, 'canaries', this.plan.manager.settings.canaries);
      }
      if (_.has(this.plan, 'manager.settings.max_in_flight')) {
        _.set(args, 'max_in_flight', this.plan.manager.settings.max_in_flight);
      }
    }
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
    let preUpdateAgentResponse = {};
    return Promise
      .try(() => {
        switch (action) {
          case CONST.OPERATION_TYPE.UPDATE:
            serviceLifeCycle = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
            if (_.get(params, 'parameters.bosh_director_name') ||
              username || password) {
              throw new BadRequest('Update cannot be done on custom BOSH');
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
              })
              .then(() => {
                let preUpdateContext = _.cloneDeep(actionContext);
                return this.executePreUpdate(deploymentName, preUpdateContext);
              })
              .tap(response => {
                logger.info(`PreUpdate action response for ${deploymentName} is ...`, response);
                preUpdateAgentResponse = response;
              });
          case CONST.OPERATION_TYPE.CREATE:
            serviceLifeCycle = CONST.SERVICE_LIFE_CYCLE.PRE_CREATE;
            if (_.get(params, 'parameters.bosh_director_name')) {
              return uaa
                .getScope(username, password)
                .then(scopes => {
                  const isAdmin = _.includes(scopes, 'cloud_controller.admin');
                  if (!isAdmin) {
                    throw new Forbidden('Token has insufficient scope');
                  }
                });
            }
            return;
        }
      })
      .then(() => this.executeActions(serviceLifeCycle, actionContext))
      .then(preDeployResponse => this.generateManifest(deploymentName, opts, preDeployResponse, preUpdateAgentResponse))
      .tap(manifest => logger.debug('+-> Deployment manifest:\n', manifest))
      .then(manifest => this.director.createOrUpdateDeployment(action, manifest, args, scheduled))
      .tap(taskId => logger.info(`+-> Scheduled ${action} deployment task '${taskId}'`))
      .catch(err => {
        logger.error(`+-> Failed to ${action} deployment`);
        logger.error(err);
        throw err;
      });
  }

  executePreUpdate(deploymentName, context) {
    _.assign(context, {
      'instance_guid': this.getInstanceGuid(context.deployment_name)
    });
    const agentProperties = catalog.getPlan(context.params.previous_values.plan_id).manager.settings.agent;
    _.chain(context.params)
      .set('service_id', this.service.id)
      .set('plan_id', this.plan.id)
      .set('agent_properties', _.omit(agentProperties, 'auth', 'provider'))
      .value();
    return this
      .getDeploymentIps(deploymentName)
      .then(ips => this.agent.preUpdate(ips, context))
      .catch(FeatureNotSupportedByAnyAgent, ServiceInstanceNotOperational, err => {
        logger.debug('+-> Caught expected error of feature \'preUpdate\':', err);
        return {};
      })
      .catch(err => {
        if (err.status === CONST.HTTP_STATUS_CODE.NOT_FOUND) {
          logger.debug('+-> Caught expected error of feature \'preUpdate\':', err);
          return {};
        }
        throw err;
      });
  }

  executeActions(phase, context) {
    // Lazy create of deploymentHookClient
    // Only Processes that require service lifecycle operations will need deployment_hooks properties.
    // Can be loaded on top when we modularize scheduler and report process codebase
    const deploymentHookClient = require('../../../applications/deployment_hooks/src/lib/utils/DeploymentHookClient');
    return Promise.try(() => {
      const serviceLevelActions = this.service.actions;
      const planLevelActions = phase === CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE ? catalog.getPlan(context.params.previous_values.plan_id).actions :
        this.plan.actions;
      if (serviceLevelActions || planLevelActions) {
        const cumulativeActions = serviceLevelActions ? (planLevelActions ? `${serviceLevelActions},${planLevelActions}` : serviceLevelActions) :
          planLevelActions;
        const actionsToPerform = _.chain(cumulativeActions)
          .replace(/\s*/g, '')
          .split(',')
          .value();
        if (actionsToPerform.length === 0) {
          logger.info(`no actions to perform for ${context.deployment_name}`);
          return {};
        }
        logger.info(`actionsToPerform - @service - ${serviceLevelActions} , @plan - ${planLevelActions}`);
        logger.info(`Cumulative actions to perform on ${context.deployment_name} - ${actionsToPerform}`);
        _.assign(context, {
          'instance_guid': this.getInstanceGuid(context.deployment_name)
        });
        _.chain(context.params)
          .set('service_id', this.service.id)
          .set('plan_id', this.plan.id)
          .value();
        const options = _.chain({})
          .set('phase', phase)
          .set('actions', actionsToPerform)
          .set('context', _.omit(context, 'params.previous_manifest'))
          .value();
        return deploymentHookClient.executeDeploymentActions(options)
          .tap(actionResponse => logger.info(`${phase} response ...`, actionResponse));
      } else {
        logger.info(`No actions to perform for ${context.deployment_name}`);
        return {};
      }
    });
  }

  delete(params, deploymentName) {
    const operation = {
      type: 'delete'
    };
    return this
      .initialize(operation, deploymentName)
      .then(() => {
        if (_.isInteger(this.networkSegmentIndex)) {
          return this.deleteDeployment(this.deploymentName, params);
        }
      })
      .catch(DirectorServiceUnavailable, err =>
        logger.warn(`Error occurred while deleting deployment for create instance guid :${this.guid}`, err))
      .then(taskId => _
        .chain(operation)
        .set('task_id', taskId)
        .set('context', {
          platform: this.platformManager.platform
        })
        .set('deployment_name', _.isInteger(this.networkSegmentIndex) ? this.deploymentName : undefined)
        .value()
      );
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
              logger.debug('+-> Caught expected error of feature \'deprovision\':', err);
              return;
            });
        }
      })
      .then(() => this.director.deleteDeployment(deploymentName))
      .tap(taskId => logger.info(`+-> Scheduled delete deployment task '${taskId}'`))
      .catchThrow(NotFound, new ServiceInstanceNotFound(this.guid))
      .catch(err => {
        logger.error('+-> Failed to delete deployment', err);
        throw err;
      });
  }

  getAgentLifecyclePostProcessingStatus(operationType, deploymentName) {
    const featureName = `lifecycle.async.post${operationType}`;
    if (_.includes(this.agent.features, featureName)) {
      return this
        .getDeploymentIps(deploymentName)
        .then(ips => this.agent.getProcessingState(ips, operationType, 'post'))
        .then(res => {
          const action = _.capitalize(operationType);
          const timestamp = res.updated_at || new Date().toISOString();
          const stage = _.get(res, 'stage', '');
          let description;
          let state;
          switch (res.state) {
            case 'succeeded':
              state = CONST.APISERVER.RESOURCE_STATE.SUCCEEDED;
              description = `${action} deployment ${deploymentName} succeeded at ${timestamp}: ${stage}`;
              break;
            case 'processing':
              state = CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING;
              description = `${action} deployment ${deploymentName} is still in progress: ${stage}`;
              break;
            case 'failed':
            default:
              state = CONST.APISERVER.RESOURCE_STATE.FAILED;
              description = `${action} deployment ${deploymentName} failed at ${timestamp} during: ${stage}`;
              break;
          }
          return {
            state,
            description
          };
        })
        .catch(FeatureNotSupportedByAnyAgent, err => {
          logger.debug('+-> Caught expected error of feature \'postprocessing\':', err);
          return {
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
          };
        })
        .catch(err => {
          // If an unexpected error occurs (e.g. bosh not reachable) try it again later
          logger.error('Error occurred while querying agent of feature \'postprocessing\':', err);
          return {
            state: CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING
          };
        });
    } else {
      return Promise.resolve({
        state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
      });
    }
  }

  getBoshTaskStatus(instanceId, operation, taskId) {
    return Promise
      .try(() => {
        assert.ok(taskId, 'Task ID must be available');
        return this.getTask(taskId);
      })
      .catchThrow(NotFound, new ServiceInstanceNotFound(instanceId))
      .then(task => {
        assert.ok(_.endsWith(task.deployment, this.guid), `Deployment '${task.deployment}' must end with '${this.guid}'`);
        this.networkSegmentIndex = this.getNetworkSegmentIndex(task.deployment);
        this.setOperationState(operation, task);
        if (operation.state !== 'in progress') {
          return Promise.try(() => this.finalize(operation));
        }
      })
      .return(operation);
  }

  lastOperation(operation) {
    logger.info('Fetching state of last operation', operation);
    const instanceId = this.guid;

    if (operation.task_id) {
      return this.getBoshTaskStatus(instanceId, operation, operation.task_id)
        .then(() => {
          if (_.get(operation, 'type') == CONST.OPERATION_TYPE.CREATE && _.get(operation, 'state') == 'failed') {
            return this.director.deleteDeployment(operation.deployment);
          }
        }).return(operation);
    } else {
      return Promise.try(() => {
        return _.assign(operation, {
          description: `${_.capitalize(operation.type)} deployment is still in progress`,
          state: 'in progress',
          resourceState: CONST.APISERVER.RESOURCE_STATE.WAITING
        });
      });
    }
  }

  setOperationState(operation, task) {
    const action = _.capitalize(operation.type);
    const timestamp = new Date(task.timestamp * 1000).toISOString();
    switch (task.state) {
      case 'done':
        // only start postprocessing if it is enabled by a feature flag and supported by the agent
        // eslint-disable-next-line no-case-declarations
        const postProcessingFeatureName = `lifecycle.async.post${operation.type}`;
        // eslint-disable-next-line no-case-declarations
        const shallWaitForPostProcessing = _.includes(this.agent.features, postProcessingFeatureName);
        return _.assign(operation, {
          description: `${action} deployment ${task.deployment} succeeded at ${timestamp}`,
          state: 'succeeded',
          resourceState: shallWaitForPostProcessing ? CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING : CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        });
      case 'error':
      case 'cancelled':
      case 'timeout':
        return _.assign(operation, {
          deployment: task.deployment,
          description: `${action} deployment ${task.deployment} failed at ${timestamp} with Error "${task.result}"`,
          state: 'failed',
          resourceState: CONST.APISERVER.RESOURCE_STATE.FAILED
        });
      default:
        return _.assign(operation, {
          description: `${action} deployment ${task.deployment} is still in progress`,
          state: 'in progress',
          resourceState: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
        });
    }
  }

  bind(params) {
    let bindingCredentials;
    return this.platformManager.preBindOperations({
      context: params.context,
      bind_resource: params.bind_resource,
      bindingId: params.binding_id
    })
      .then(() => this
        .initialize({
          type: 'bind'
        }))
      .then(() => this.createBinding(this.deploymentName, {
        id: params.binding_id,
        parameters: params.parameters || {}
      }))
      .tap(credentials => bindingCredentials = credentials)
      .then(() => this.platformManager.postBindOperations({
        context: params.context,
        bind_resource: params.bind_resource,
        bindingId: params.binding_id,
        ipRuleOptions: this.buildIpRules()
      }))
      .then(() => bindingCredentials)
      .tap(() => {
        if (this.platformManager.platformName === CONST.PLATFORM.CF) {
          return this
            .scheduleBackUp()
            .catch(() => {});
        } else {
          // TODO: revisit this when supporting extension APIs for K8S consumption
          return;
        }
      });
  }

  createBinding(deploymentName, binding) {
    verifyFeatureSupport(this.plan, 'credentials');
    logger.info(`Creating binding '${binding.id}' for deployment '${deploymentName}'...`);
    logger.info('+-> Binding parameters:', binding.parameters);
    let actionContext = {
      'deployment_name': deploymentName
    };
    _.assign(actionContext, binding);
    return Promise.join(
      this.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_BIND, actionContext),
      this.getDeploymentIps(deploymentName),
      (preBindResponse, ips) => retry(() => this.agent.createCredentials(ips, binding.parameters, preBindResponse), {
        operation: 'Create Credentials by Service Agent',
        maxAttempts: 2,
        timeout: config.agent_operation_timeout || CONST.AGENT.OPERATION_TIMEOUT_IN_MILLIS
      })
        .catch(Timeout, err => {
          throw err;
        })
    )
      .tap(credentials => {
        _.set(binding, 'credentials', credentials);
        const bindCreds = _.cloneDeep(binding.credentials);
        maskSensitiveInfo(bindCreds);
        logger.info(`+-> Created binding:${JSON.stringify(bindCreds)}`);
      })
      .catch(err => {
        logger.error(`+-> Failed to create binding for deployment ${deploymentName} with id ${binding.id}`);
        logger.error(err);
        throw err;
      });
  }

  unbind(params) {
    return this
      .initialize({
        type: 'unbind'
      })
      .then(() => this.platformManager.preUnbindOperations({
        bindingId: params.binding_id
      }))
      .then(() => this.deleteBinding(this.deploymentName, params.binding_id));
  }

  deleteBinding(deploymentName, id) {
    verifyFeatureSupport(this.plan, 'credentials');
    logger.info(`Deleting binding '${id}' for deployment '${deploymentName}'...`);
    let actionContext = {
      'deployment_name': deploymentName,
      'id': id
    };
    return this.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_UNBIND, actionContext)
      .then(preUnbindResponse =>
        Promise
          .all([
            Promise.resolve(preUnbindResponse),
            this.getDeploymentIps(deploymentName),
            this.getCredentials(id)
          ]))
      .spread((preUnbindResponse, ips, credentials) => retry(() => this.agent.deleteCredentials(ips, credentials, preUnbindResponse), {
        operation: 'Delete Credentials by Service Agent',
        maxAttempts: 2,
        timeout: config.agent_operation_timeout || CONST.AGENT.OPERATION_TIMEOUT_IN_MILLIS
      })
        .catch(Timeout, err => {
          throw err;
        })
      )
      .tap(() => logger.info('+-> Deleted service credentials'))
      .catch(err => {
        logger.error(`+-> Failed to delete binding for deployment ${deploymentName} with id ${id}`);
        logger.error(err);
        throw err;
      });
  }

  getCredentials(id) {
    logger.info(`[getCredentials] making request to ApiServer for binding ${id}`);
    return retry(tries => {
      logger.debug(`+-> Attempt ${tries + 1} to get binding ${id} from apiserver`);
      return apiServerClient.getResponse({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
        resourceId: id
      })
        .then(response => {
          logger.debug(`[getCredentials] Response obtained from ApiServer for ${id}`);
          if (response) {
            return decodeBase64(response);
          }
        });
    }, {
      maxAttempts: 3,
      minDelay: 1000,
      predicate: err => !(err instanceof NotFound)
    })
      .catch(err => {
        logger.error(`[getCredentials] error while fetching resource for binding ${id} - `, err);
        throw err;
      });
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

  generateManifest(deploymentName, opts, preDeployResponse, preUpdateAgentResponse) {
    return this.platformManager
      .isMultiAzDeploymentEnabled(opts)
      .then(isMultiAzEnabled => {
        const index = opts.network_index || this.getNetworkSegmentIndex(deploymentName);
        const networks = this.getNetworks(index);
        const allRequiredNetworks = _.union(networks.dynamic, networks.all.filter(net => _.startsWith(net.name, this.networkName)));
        const tags = _.pick(opts.context, 'organization_guid', 'space_guid');
        const serviceId = opts.service_id;
        if (serviceId) {
          _.assign(tags, _.get(catalog.getService(serviceId), 'service_tags'));
        }
        const skipAddOns = _.get(opts, 'skip_addons', false) || _.get(config, 'service_addon_jobs', []).length === 0;
        const header = new Header({
          name: deploymentName,
          director_uuid: this.director.uuid,
          releases: this.releases,
          stemcells: [this.stemcell],
          tags: tags,
          networks: _.map(allRequiredNetworks, net => net.toJSON()),
          release_name: !skipAddOns ? config.release_name : undefined,
          release_version: !skipAddOns ? config.release_version : undefined
        });
        const context = new EvaluationContext(_.assign({
          index: index,
          header: header,
          cpi: this.director.cpi,
          networks: networks[this.networkName],
          parameters: opts.parameters || {},
          properties: this.settings.context || {},
          previous_manifest: opts.previous_manifest,
          multi_az_enabled: isMultiAzEnabled,
          stemcell: this.stemcell,
          actions: preDeployResponse,
          preUpdateAgentResponse: preUpdateAgentResponse,
          selfSigned: selfSigned
        }, opts.context));
        logger.info('Predeploy response -', preDeployResponse);
        logger.info('Multi-az Enabled : ', context.spec.multi_az_enabled);
        logger.info('network name to be used for deployment ', this.networkName);
        logger.debug('network config to be used:', networks[this.networkName]);
        if (networks[this.networkName] === undefined) {
          logger.error(`subnet ${this.networkName} definition not found among the applicable networks defintion : ${JSON.stringify(networks)}`);
          throw new UnprocessableEntity(`subnet ${this.networkName} definition not found`);
        }
        let manifestYml = _.template(this.template)(context);
        if (!skipAddOns) {
          const serviceManifest = yaml.safeLoad(manifestYml);
          this.configureAddOnJobs(serviceManifest, context.spec);
          manifestYml = yaml.safeDump(serviceManifest);
        }
        return manifestYml;
      });
  }

  configureAddOnJobs(serviceManifest, context) {
    const shouldEnableConnections = _.get(catalog.getService(this.service.id), 'enable_connections', false);
    _.set(context, 'shouldEnableConnections', shouldEnableConnections);
    const addOns = new Addons(context).getAll();
    if (serviceManifest.addons) {
      serviceManifest.addons = serviceManifest.addons.concat.apply(serviceManifest.addons, addOns);
    } else {
      serviceManifest.addons = addOns;
    }
  }

  getApplicationAccessPortsOfService() {
    let service = this.service.toJSON();
    return _.get(service, 'application_access_ports');
  }

  buildIpRules() {
    let applicationAccessPorts = this.getApplicationAccessPortsOfService();
    return _.map(this.getNetwork(this.networkSegmentIndex), net => {
      return {
        protocol: 'tcp',
        ips: net.static,
        applicationAccessPorts: applicationAccessPorts
      };
    });
  }

  scheduleBackUp() {
    const options = {
      instance_id: this.guid,
      repeatInterval: 'daily',
      type: CONST.BACKUP.TYPE.ONLINE
    };
    logger.debug(`Scheduling backup for  instance : ${this.guid}`);
    return Promise
      .try(() => {
        if (isFeatureEnabled(CONST.FEATURE.SCHEDULED_BACKUP)) {
          try {
            verifyFeatureSupport(this.plan, 'backup');
            ScheduleManager
              .getSchedule(this.guid, CONST.JOB.SCHEDULED_BACKUP)
              .then(schedule => {
                logger.info(`Backup Job : ${schedule.name} already scheduled for instance : ${this.guid} with interval ${schedule.repeatInterval}`);
                return;
              })
              .catch(error => {
                if (typeof error !== NotFound) {
                  // NotFound is an expected error.
                  logger.warn('error occurred while fetching schedule for existing job', error);
                }
                if (this.service.backup_interval) {
                  options.repeatInterval = this.service.backup_interval;
                }
                logger.info(`Scheduling Backup for instance : ${this.guid} with backup interval of - ${options.repeatInterval}`);
                // Even if there is an error while fetching backup schedule, trigger backup schedule we would want audit log captured and riemann alert sent
                // This flow has to be revisited when we start supporting K8s through service manager
                return this.serviceFabrikClient.scheduleBackup(options);
              });
          } catch (err) {
            logger.error(`Error occurred while scheduling backup for instance: ${this.guid}. More info:`, err);
          }
        } else {
          logger.info('Scheduled Backup feature not enabled');
        }
      });
  }

  scheduleAutoUpdate() {
    const options = {
      instance_id: this.guid,
      repeatInterval: CONST.SCHEDULE.RANDOM,
      timeZone: _.get(config, 'scheduler.jobs.service_instance_update.time_zone', 'UTC')
    };
    return retry(tries => {
      logger.info(`+-> ${CONST.ORDINALS[tries]} attempt to schedule auto update for : ${this.guid}`);
      if (isFeatureEnabled(CONST.FEATURE.SCHEDULED_UPDATE)) {
        return this
          .serviceFabrikClient
          .scheduleUpdate(options)
          .catch(err => {
            logger.error(`Error occurred while setting up auto update for : ${this.guid}`, err);
            throw err;
          });
      } else {
        logger.warn(` Schedule update feature is disabled. Auto update not scheduled for instance : ${this.guid}`);
      }
    }, {
      maxAttempts: 3,
      minDelay: 1000
    })
      .catch(err => logger.error(`Error occurred while scheduling auto-update for instance: ${this.guid} - `, err));
  }

  /* Dashboard rendering functions */
  getInfo() {
    const operation = {
      type: 'get'
    };
    return Promise
      .all([
        apiServerClient.getResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: this.guid
        }),
        this.initialize(operation).then(() => this.getDeploymentInfo(this.deploymentName))
      ])
      .spread((instance, deploymentInfo) => {
        return {
          title: `${this.plan.service.metadata.displayName || 'Service'} Dashboard`,
          plan: this.plan,
          service: this.plan.service,
          instance: _.set(instance, 'task', deploymentInfo),
          files: [{
            id: 'status',
            title: 'Status',
            language: 'yaml',
            content: yaml.dump(deploymentInfo)
          }]
        };
      });
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
          total: event.total
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

  findDeploymentTask(deploymentName) {
    return this.director
      .getTasks({
        deployment: deploymentName
      }, true)
      .then(tasks => _
        .chain(tasks)
        .sortBy('id')
        .find(task => /^create\s+deployment/.test(task.description))
        .value()
      );
  }

  static createInstance(instanceId, options) {
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const context = _.get(options, 'context');
    const directorService = new DirectorService(plan, instanceId);
    return Promise
      .try(() => context ? context : directorService.platformContext)
      .then(context => directorService.assignPlatformManager(getPlatformManager(context)))
      .return(directorService);
  }
}

module.exports = DirectorService;
