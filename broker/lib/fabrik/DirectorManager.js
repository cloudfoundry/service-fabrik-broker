'use strict';

const _ = require('lodash');
const yaml = require('js-yaml');
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
const ScheduleManager = require('../jobs');
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
const Forbidden = errors.Forbidden;
const DeploymentDelayed = errors.DeploymentDelayed;
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
      shouldRunNow: false,
      enqueue: false
    };
    results.shouldRunNow = shouldRunNow;
    if (scheduled) {
      if (shouldRunNow) {
        //do not store in etcd for scheduled updates
        results.shouldRunNow = shouldRunNow;
        return results;
      } else {
        throw new DeploymentDelayed(deploymentName);
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
    const runImmediately = _.get(params, '_runImmediately') || false;
    _.omit(params, 'scheduled');
    _.omit(params, '_runImmediately');

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
    const deploymentHookClient = require('../utils/DeploymentHookClient');
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
        throw new errors.DeploymentAlreadyLocked(this.getInstanceGuid(deploymentName), lockInfo);
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

    const lockInfo = {
      username: data.username,
      lockForOperation: `${data.trigger}_${data.operation}`
    };
    let lockAcquired = false,
      metaUpdated = false,
      backupStarted = false,
      registeredStatusPoller = false;

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
            // set data and result agent ip
            data.agent_ip = result.agent_ip = agent_ip;
            instanceInfo = _.chain(data)
              .pick('tenant_id', 'backup_guid', 'instance_guid', 'agent_ip', 'service_id', 'plan_id')
              .set('deployment', deploymentName)
              .set('started_at', backupStartedAt)
              .value();
            return DirectorManager.registerBnRStatusPoller({
              operation: 'backup',
              type: backup.type,
              trigger: backup.trigger
            }, instanceInfo);
          })
          .then(agent_ip => {
            registeredStatusPoller = true;
            return this.agent.startBackup(agent_ip, backup, vms);
          })
          .then(() => {
            backupStarted = true;
            return this.backupStore.putFile(data);
          })
          .then(() => {
            metaUpdated = true;
            return this
              .acquireLock(deploymentName, lockInfo)
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
            if (registeredStatusPoller) {
              logger.error(`Error occurred during backup process. Cancelling status poller for deployment : ${deploymentName} and backup_guid: ${instanceInfo.backup_guid}`);
              return ScheduleManager
                .cancelSchedule(`${deploymentName}_backup_${instanceInfo.backup_guid}`,
                  CONST.JOB.BNR_STATUS_POLLER)
                .catch((err) => logger.error('Error occurred while performing clean up of backup failure operation : ', err));
            }
          })
          .tap(() => {
            if (backupStarted) {
              logger.error(`Error occurred during backup process. Aborting backup on deployment : ${deploymentName}`);
              return this
                .abortLastBackup(data.tenant_id, data.instance_guid, true)
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