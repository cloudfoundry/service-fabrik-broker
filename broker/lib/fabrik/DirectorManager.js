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

  getDeploymentManifest(deploymentName) {
    logger.info(`Fetching deployment manifest '${deploymentName}'...`);
    return this.director
      .getDeploymentManifest(deploymentName)
      .tap(() => logger.info('+-> Fetched deployment manifest'))
      .catch(err => {
        logger.error('+-> Failed to fetch deployment manifest', err);
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
        logger.error(`+-> Failed to ${action} deployment`, err);
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
        logger.error('+-> Failed to create binding', err);
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

  getServiceInstanceState(instanceGuid) {
    return this
      .findNetworkSegmentIndex(instanceGuid)
      .then(networkSegmentIndex => this.getDeploymentName(instanceGuid, networkSegmentIndex))
      .then(deploymentName => this.getDeploymentIps(deploymentName))
      .then(ips => this.agent.getState(ips));
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