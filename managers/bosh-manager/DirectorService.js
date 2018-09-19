'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const config = require('../../common/config');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const catalog = require('../../common/models').catalog;
const NotFound = errors.NotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const ScheduleManager = require('../../jobs');
const CONST = require('../../common/constants');
const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const bosh = require('../../data-access-layer/bosh');
const Agent = require('../../data-access-layer/service-agent');
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const backupStore = require('../../data-access-layer/iaas').backupStore;
const boshOperationQueue = bosh.BoshOperationQueue;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotOperational = errors.ServiceInstanceNotOperational;
const FeatureNotSupportedByAnyAgent = errors.FeatureNotSupportedByAnyAgent;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const DeploymentDelayed = errors.DeploymentDelayed;
const BaseDirectorService = require('../BaseDirectorService');
const cf = require('../../data-access-layer/cf');
const cloudController = cf.cloudController;
const serviceFabrikClient = cf.serviceFabrikClient;
const Header = bosh.manifest.Header;
const Addons = bosh.manifest.Addons;
const EvaluationContext = bosh.EvaluationContext;
const BadRequest = errors.BadRequest;
const BasePlatformManager = require('../../broker/lib/fabrik/BasePlatformManager');


class DirectorService extends BaseDirectorService {
  constructor(guid, plan) {
    super(plan);
    this.guid = guid;
    this.plan = plan;
    this.cloudController = cloudController;
    this.serviceFabrikClient = serviceFabrikClient;
    this.director = bosh.director;
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
    return Promise.try(() => this.networkSegmentIndex ? this.deploymentName : this.director.getDeploymentNameForInstanceId(this.guid))
      .then(deploymentName => this.director.getDeploymentProperty(deploymentName, CONST.PLATFORM_CONTEXT_KEY))
      .then(context => JSON.parse(context))
      .catch(NotFound, () => {
        /* Following is to handle existing deployments. 
           For them platform-context is not saved in deployment property. Defaults to CF.
         */
        logger.warn(`Deployment property '${CONST.PLATFORM_CONTEXT_KEY}' not found for instance '${this.guid}'.\ 
        Setting default platform as '${CONST.PLATFORM.CF}'`);

        const context = {
          platform: CONST.PLATFORM.CF
        };
        return context;
      });
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

  getNetworkSegmentIndex(deploymentName) {
    return _.nth(BaseDirectorService.parseDeploymentName(deploymentName, this.subnet), 1);
  }

  getInstanceGuid(deploymentName) {
    return _.nth(BaseDirectorService.parseDeploymentName(deploymentName, this.subnet), 2);
  }

  initialize(operation) {
    return Promise
      .try(() => {
        this.operation = operation.type;
        if (operation.type === CONST.OPERATION_TYPE.CREATE) {
          return this.acquireNetworkSegmentIndex(this.guid);
        }
        return this.findNetworkSegmentIndex(this.guid);
      })
      .tap(networkSegmentIndex => {
        assert.ok(_.isInteger(networkSegmentIndex), `Network segment index '${networkSegmentIndex}' must be an integer`);
        this.networkSegmentIndex = networkSegmentIndex;
      })
      .tap(() => {
        if (operation.type === 'delete') {
          return Promise
            .all([
              this.platformManager.preInstanceDeleteOperations({
                guid: this.guid
              }),
              this.deleteRestoreFile()
            ]);
        }
      });
  }

  acquireNetworkSegmentIndex(guid) {
    logger.debug(`Acquiring network segment index for a new deployment with instance id '${guid}'...`);
    const promises = [this.getDeploymentNames(true)];
    if (config.enable_bosh_rate_limit) {
      promises.push(this.getDeploymentNamesInCache());
    }
    return Promise.all(promises)
      .then(deploymentNameCollection => _.flatten(deploymentNameCollection))
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
          return utils
            .retry(tries => {
              logger.info(`+-> ${ordinals[tries]} attempt to create property '${CONST.PLATFORM_CONTEXT_KEY}' for deployment '${this.deploymentName}'...`);
              return this.director
                .createDeploymentProperty(this.deploymentName, CONST.PLATFORM_CONTEXT_KEY, JSON.stringify(operation.context))
                .catch(err => {
                  logger.error(`Error occured while trying to create deployment property for deployment ${this.deploymentName}`, err);
                  throw err;
                });
            }, {
              maxAttempts: 3,
              minDelay: 1000
            })
            .then(() => this.platformManager.postInstanceProvisionOperations({
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
        state: 'failed',
        description: `${action} deployment '${this.deploymentName}' not yet completely succeeded because "${err.message}"`
      }));
  }

  create(params) {
    const operation = {
      type: 'create'
    };
    return this
      .initialize(operation)
      .then(() => {
        return this.createOrUpdateDeployment(this.deploymentName, params);
      })
      .then(op => _
        .chain(operation)
        .assign(_.pick(params, 'parameters', 'context'))
        .set('task_id', op.task_id)
        .set('cached', op.cached)
        .value()
      );
  }

  update(params) {
    const operation = {
      type: 'update'
    };
    return this
      .initialize(operation)
      .then(() => {
        logger.info('Parameters for update operation:', _.get(params, 'parameters'));
        this.operation = this.operation || 'update';
        return this.createOrUpdateDeployment(this.deploymentName, params)
          .then(op => _
            .chain(operation)
            .assign(_.pick(params, 'parameters', 'context'))
            .set('task_id', op.task_id)
            .set('cached', op.cached)
            .value()
          );
      });
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
    return boshOperationQueue.getDeploymentNames();
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
          //no slots left anyway
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
          //should run if the tasks count is lesser than the specified max workers for op type
          runOutput.shouldRunNow = true;
          return runOutput;
        }
        return runOutput;
      }).catch(err => {
        logger.error('Error connecting to BOSH director > could not fetch current tasks', err);
        //in case the director request returns an error, we queue it to avoid user experience issues
        // return with shouldRunNow = false so that it is taken care of in processing
        return runOutput;
      });
  }

  _deleteEntity(action, opts) {
    return utils.retry(tries => {
        logger.info(`+-> Attempt ${tries + 1}, action "${opts.actionName}"...`);
        return action();
      }, {
        maxAttempts: opts.maxAttempts,
        minDelay: opts.minDelay
      })
      .catch(err => {
        logger.error(`Timeout Error for action "${opts.actionName}" after multiple attempts`, err);
        throw err;
      });
  }

  cleanupOperation(deploymentName) {
    return Promise.try(() => {
      if (!config.enable_bosh_rate_limit) {
        return;
      }
      const serviceInstanceId = this.getInstanceGuid(deploymentName);
      let retryTaskDelete = this._deleteEntity(() => {
        return boshOperationQueue.deleteBoshTask(serviceInstanceId);
      }, {
        actionName: `delete bosh task for instance ${serviceInstanceId}`,
        maxAttempts: 5,
        minDelay: 1000
      });
      let retryDeploymentDelete = this._deleteEntity(() => {
        return boshOperationQueue.deleteDeploymentFromCache(deploymentName);
      }, {
        actionName: `delete bosh deployment ${deploymentName}`,
        maxAttempts: 5,
        minDelay: 1000
      });
      return Promise.all([retryTaskDelete, retryDeploymentDelete]);
    });
  }

  getCurrentOperationState(serviceInstanceId) {
    let output = {
      'cached': false,
      'task_id': null
    };

    return Promise.all([boshOperationQueue.containsServiceInstance(serviceInstanceId), boshOperationQueue.getBoshTask(serviceInstanceId)])
      .spread((cached, taskId) => {
        output.cached = cached;
        output.task_id = taskId;
      })
      .return(output);
  }

  enqueueOrTrigger(shouldRunNow, scheduled, deploymentName) {
    const results = {
      cached: false,
      shouldRunNow: shouldRunNow,
      enqueue: false
    };
    if (scheduled) {
      if (shouldRunNow) {
        //do not store in etcd for scheduled updates
        results.shouldRunNow = shouldRunNow;
        return results;
      } else {
        throw new errors.DeploymentAttemptRejected(deploymentName);
      }
    } else {
      // user-triggered operations
      if (shouldRunNow) {
        //check if the deployment already exists in etcd (poller-run)
        return boshOperationQueue.containsDeployment(deploymentName).then(enqueued => {
          if (enqueued) {
            results.cached = true;
          }
          return results;
        });
      } else {
        results.enqueue = true;
        return results;
      }
    }
  }

  createOrUpdateDeployment(deploymentName, params, args) {
    logger.info(`Checking rate limits against bosh for deployment `);
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
            cached: false,
            task_id: taskId
          };
        });
    }
    const decisionMaker = {
      'shouldRunNow': false,
      'cached': false
    };
    return this.executePolicy(scheduled, action, deploymentName)
      .then(checkResults => this.enqueueOrTrigger(checkResults.shouldRunNow, scheduled, deploymentName))
      .tap(res => {
        decisionMaker.shouldRunNow = res.shouldRunNow;
        decisionMaker.cached = res.cached;
      })
      .then(res => {
        if (res.enqueue) {
          // stagger here by putting it into etcd cache and return promise
          return boshOperationQueue.saveDeployment(this.plan.id, deploymentName, params, args)
            .then(() => {
              decisionMaker.cached = true;
              throw new DeploymentDelayed(deploymentName);
            });
        }
      })
      .then(() => {
        if (decisionMaker.shouldRunNow && decisionMaker.cached) {
          //the deployment was cached in etcd earlier; remove it from cache and proceed
          return boshOperationQueue.deleteDeploymentFromCache(deploymentName);
        }
      })
      .then(() => this._createOrUpdateDeployment(deploymentName, params, args, scheduled))
      .then(taskId => {
        const out = {
          'cached': false
        };
        if (decisionMaker.cached) {
          return boshOperationQueue.saveBoshTask(this.getInstanceGuid(deploymentName), taskId)
            .then(() => {
              out.cached = true;
              out.task_id = taskId;
              return out;
            });
        } else {
          out.task_id = taskId;
          return out;
        }
      })
      .catch(DeploymentDelayed, e => {
        logger.info(`Deployment ${deploymentName} delayed- this should be picked up later for processing`, e);
        return {
          'cached': true
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
      .then((preDeployResponse) => this.generateManifest(deploymentName, opts, preDeployResponse, preUpdateAgentResponse))
      .tap(manifest => logger.info('+-> Deployment manifest:\n', manifest))
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
    //Lazy create of deploymentHookClient
    //Only Processes that require service lifecycle operations will need deployment_hooks properties.
    //Can be loaded on top when we modularize scheduler and report process codebase
    const deploymentHookClient = require('../../common/utils/DeploymentHookClient');
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
          .set('context', context)
          .value();
        return deploymentHookClient.executeDeploymentActions(options)
          .tap((actionResponse) => logger.info(`${phase} response ...`, actionResponse));
      } else {
        logger.info(`No actions to perform for ${context.deployment_name}`);
        return {};
      }
    });
  }

  delete(params) {
    const operation = {
      type: 'delete'
    };
    return this
      .initialize(operation)
      .then(() => this.deleteDeployment(this.deploymentName, params))
      .then(taskId => _
        .chain(operation)
        .set('task_id', taskId)
        .set('context', {
          platform: this.platformManager.platform
        })
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
      .catch(err => {
        logger.error('+-> Failed to delete deployment');
        logger.error(err);
        throw err;
      });
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
          return Promise.try(() => {
              return this.cleanupOperation(task.deployment);
            })
            .then(() => this.finalize(operation));
        }
      })
      .return(operation);
  }

  lastOperation(operation) {
    logger.info('Fetching state of last operation', operation);
    const instanceId = this.guid;

    if (operation.task_id) {
      return this.getBoshTaskStatus(instanceId, operation, operation.task_id);
    } else {
      return Promise.try(() => {
        return this.getCurrentOperationState(this.guid);
      }).then(state => {
        const isCached = state.cached;
        const taskId = state.task_id;
        if (isCached) {
          return _.assign(operation, {
            description: `${_.capitalize(operation.type)} deployment is still in progress`,
            state: 'in progress'
          });
        } else {
          return this.getBoshTaskStatus(instanceId, operation, taskId);
        }
      });
    }
  }

  setOperationState(operation, task) {
    const action = _.capitalize(operation.type);
    const timestamp = new Date(task.timestamp * 1000).toISOString();
    switch (task.state) {
    case 'done':
      return _.assign(operation, {
        description: `${action} deployment ${task.deployment} succeeded at ${timestamp}`,
        state: 'succeeded',
        resourceState: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
      });
    case 'error':
    case 'cancelled':
    case 'timeout':
      return _.assign(operation, {
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
    return this
      .initialize({
        type: 'bind'
      })
      .then(() => this.createBinding(this.deploymentName, {
        id: params.binding_id,
        parameters: params.parameters || {}
      }))
      .tap(() => this
        .scheduleBackUp()
        .catch(() => {}));
  }

  createBinding(deploymentName, binding) {
    this.verifyFeatureSupport('credentials');
    logger.info(`Creating binding '${binding.id}' for deployment '${deploymentName}'...`);
    logger.info('+-> Binding parameters:', binding.parameters);
    let actionContext = {
      'deployment_name': deploymentName
    };
    _.assign(actionContext, binding);
    return Promise.join(
        this.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_BIND, actionContext),
        this.getDeploymentIps(deploymentName),
        (preBindResponse, ips) => utils.retry(() => this.agent.createCredentials(ips, binding.parameters, preBindResponse), {
          maxAttempts: 3,
          timeout: config.agent_operation_timeout || CONST.AGENT.OPERATION_TIMEOUT_IN_MILLIS
        })
        .catch(errors.Timeout, err => {
          throw err;
        })
      )
      .tap(credentials => this.createBindingProperty(deploymentName, binding.id, _.set(binding, 'credentials', credentials)))
      .tap(() => {
        const bindCreds = _.cloneDeep(binding.credentials);
        utils.maskSensitiveInfo(bindCreds);
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
      .then(() => this.deleteBinding(this.deploymentName, params.binding_id));
  }

  deleteBinding(deploymentName, id) {
    this.verifyFeatureSupport('credentials');
    logger.info(`Deleting binding '${id}' for deployment '${deploymentName}'...`);
    let actionContext = {
      'deployment_name': deploymentName,
      'id': id
    };
    return this.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_UNBIND, actionContext)
      .then((preUnbindResponse) =>
        Promise
        .all([
          Promise.resolve(preUnbindResponse),
          this.getDeploymentIps(deploymentName),
          this.getBindingProperty(deploymentName, id)
        ]))
      .spread((preUnbindResponse, ips, binding) => utils.retry(() => this.agent.deleteCredentials(ips, binding.credentials, preUnbindResponse), {
          maxAttempts: 3,
          timeout: config.agent_operation_timeout || CONST.AGENT.OPERATION_TIMEOUT_IN_MILLIS
        })
        .catch(errors.Timeout, err => {
          throw err;
        })
      )
      .then(() => this.deleteBindingProperty(deploymentName, id))
      .tap(() => logger.info('+-> Deleted service binding'))
      .catch(err => {
        logger.error(`+-> Failed to delete binding for deployment ${deploymentName} with id ${id}`);
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

  generateManifest(deploymentName, opts, preDeployResponse, preUpdateAgentResponse) {
    const index = opts.network_index || this.getNetworkSegmentIndex(deploymentName);
    const networks = this.getNetworks(index);
    const allRequiredNetworks = _.union(networks.dynamic, networks.all.filter(net => _.startsWith(net.name, this.networkName)));
    const tags = opts.context;
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
      multi_az_enabled: config.multi_az_enabled,
      stemcell: this.stemcell,
      actions: preDeployResponse,
      preUpdateAgentResponse: preUpdateAgentResponse
    }, opts.context));
    logger.info('Predeploy response -', preDeployResponse);
    if (networks[this.networkName] === undefined) {
      logger.error(`subnet ${this.networkName} definition not found among the applicable networks defintion : ${JSON.stringify(networks)}`);
      throw new errors.UnprocessableEntity(`subnet ${this.networkName} definition not found`);
    }
    let manifestYml = _.template(this.template)(context);
    if (!skipAddOns) {
      const serviceManifest = yaml.safeLoad(manifestYml);
      this.configureAddOnJobs(serviceManifest, context.spec);
      manifestYml = yaml.safeDump(serviceManifest);
    }
    return manifestYml;
  }

  configureAddOnJobs(serviceManifest, context) {
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
        if (utils.isFeatureEnabled(CONST.FEATURE.SCHEDULED_BACKUP)) {
          try {
            this.verifyFeatureSupport('backup');
            ScheduleManager
              .getSchedule(this.guid, CONST.JOB.SCHEDULED_BACKUP)
              .then(schedule => {
                logger.info(`Backup Job : ${schedule.name} already scheduled for instance : ${this.guid} with interval ${schedule.repeatInterval}`);
                return;
              })
              .catch((error) => {
                if (typeof error !== errors.NotFound) {
                  //NotFound is an expected error.
                  logger.warn('error occurred while fetching schedule for existing job', error);
                }
                if (this.service.backup_interval) {
                  options.repeatInterval = this.service.backup_interval;
                }
                logger.info(`Scheduling Backup for instance : ${this.guid} with backup interval of - ${options.repeatInterval}`);
                //Even if there is an error while fetching backup schedule, trigger backup schedule we would want audit log captured and riemann alert sent
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
    return utils
      .retry(tries => {
        logger.info(`+-> ${CONST.ORDINALS[tries]} attempt to schedule auto update for : ${this.guid}`);
        if (utils.isFeatureEnabled(CONST.FEATURE.SCHEDULED_UPDATE)) {
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

  static createInstance(instanceId, options) {
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const context = _.get(options, 'context');
    const directorService = new DirectorService(instanceId, plan);
    return Promise
      .try(() => context ? context : directorService.platformContext)
      .then(context => directorService.assignPlatformManager(DirectorService.getPlatformManager(context.platform)))
      .return(directorService);
  }

  static getPlatformManager(platform) {
    const PlatformManager = (platform && CONST.PLATFORM_MANAGER[platform]) ? require(`../../broker/lib/fabrik/${CONST.PLATFORM_MANAGER[platform]}`) : ((platform && CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]) ? require(`../../broker/lib/fabrik/${CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]}`) : undefined);
    if (PlatformManager === undefined) {
      return new BasePlatformManager(platform);
    } else {
      return new PlatformManager(platform);
    }
  }
}

module.exports = DirectorService;