'use strict';

const _ = require('lodash');
const yaml = require('js-yaml');
const Promise = require('bluebird');
const config = require('../../../common/config');
const logger = require('../../../common/logger');
const errors = require('../../../common/errors');
const bosh = require('../../../data-access-layer/bosh');
const cf = require('../../../data-access-layer/cf');
const backupStore = require('../../../data-access-layer/iaas').backupStore;
const utils = require('../../../common/utils');
const Agent = require('../../../data-access-layer/service-agent');
const BaseManager = require('./BaseManager');
const DirectorInstance = require('./DirectorInstance');
const CONST = require('../../../common/constants');
const BoshDirectorClient = bosh.BoshDirectorClient;
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const EvaluationContext = bosh.EvaluationContext;
const boshOperationQueue = bosh.BoshOperationQueue;
const Networks = bosh.manifest.Networks;
const Header = bosh.manifest.Header;
const Addons = bosh.manifest.Addons;
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;
const NotImplemented = errors.NotImplemented;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotOperational = errors.ServiceInstanceNotOperational;
const FeatureNotSupportedByAnyAgent = errors.FeatureNotSupportedByAnyAgent;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const DeploymentDelayed = errors.DeploymentDelayed;
const catalog = require('../../../common/models/catalog');

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
    logger.info(`Acquiring network segment index for a new deployment with instance id '${guid}'...`);
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

  getDeploymentIps(deploymentName) {
    return this.director.getDeploymentIps(deploymentName);
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
    const scheduled = _.get(params, 'scheduled') || false;
    const runImmediately = _.get(params, 'parameters._runImmediately') || false;
    _.omit(params, 'scheduled');
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
    const deploymentHookClient = require('../../../common/utils/DeploymentHookClient');
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
        (preBindResponse, ips) => this.agent.createCredentials(ips, binding.parameters, preBindResponse)
      )
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
      .then((preUnbindResponse) =>
        Promise
        .all([
          Promise.resolve(preUnbindResponse),
          this.getDeploymentIps(deploymentName),
          this.getBindingProperty(deploymentName, id)
        ]))
      .spread((preUnbindResponse, ips, binding) => this.agent.deleteCredentials(ips, binding.credentials, preUnbindResponse))
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
    case CONST.OPERATION_TYPE.RESTORE:
      return this.startRestore(opts);
    }
    throw new BadRequest(`Invalid service fabrik operation '${name}'`);
  }

  getServiceFabrikOperationState(name, opts) {
    logger.info(`Retrieving state of last service fabrik operation '${name}' with:`, opts);
    return Promise
      .try(() => {
        switch (name) {
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
          return Promise.all([this.agent
              .getRestoreLogs(agent_ip), this.backupStore
              .getRestoreFile(options)
            ])
            .spread((logs, restoreMetadata) => {
              const restoreFinishiedAt = lastOperation.updated_at ? new Date(lastOperation.updated_at).toISOString() : new Date().toISOString();
              const date_history = this.updateHistoryOfDates(
                _.get(restoreMetadata, 'date_history'), restoreFinishiedAt);
              return this.backupStore
                .patchRestoreFile(options, {
                  state: lastOperation.state,
                  logs: logs,
                  finished_at: restoreFinishiedAt,
                  date_history: date_history
                });
            })
            .tap(() => {
              // Trigger schedule backup when restore is successful
              if (lastOperation.state === CONST.OPERATION.SUCCEEDED) {
                return this.reScheduleBackup({
                  instance_id: options.instance_guid,
                  afterXminute: 3
                });
              }
            });
        }
      });
  }

  updateHistoryOfDates(arrayOfDates, isoDateToUpdate) {
    let updatedHistory = arrayOfDates || [];
    updatedHistory.push(isoDateToUpdate);
    _.remove(updatedHistory, date => {
      const twoMonthOlderDate = Date.now() - 1000 * 60 * 60 * 24 * 60;
      return Date.parse(date) < twoMonthOlderDate;
    });
    return updatedHistory.sort();
  }

  reScheduleBackup(opts) {
    const options = {
      instance_id: opts.instance_id,
      type: CONST.BACKUP.TYPE.ONLINE
    };
    let interval;
    if (this.service.backup_interval) {
      interval = this.service.backup_interval;
    }
    options.repeatInterval = utils.getCronWithIntervalAndAfterXminute(interval, opts.afterXminute);
    logger.info(`Scheduling Backup for instance : ${options.instance_id} with backup interval of - ${options.repeatInterval}`);
    //Even if there is an error while fetching backup schedule, trigger backup schedule we would want audit log captured and riemann alert sent
    return cf.serviceFabrikClient.scheduleBackup(options);
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