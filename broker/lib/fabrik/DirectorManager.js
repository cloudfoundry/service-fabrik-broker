'use strict';

const _ = require('lodash');
const yaml = require('js-yaml');
const config = require('../../../common/config');
const logger = require('../../../common/logger');
const errors = require('../../../common/errors');
const bosh = require('../../../data-access-layer/bosh');
const backupStore = require('../../../data-access-layer/iaas').backupStore;
const utils = require('../../../common/utils');
const Agent = require('../../../data-access-layer/service-agent');
const BaseManager = require('./BaseManager');
const DirectorInstance = require('./DirectorInstance');
const BoshDirectorClient = bosh.BoshDirectorClient;
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const EvaluationContext = bosh.EvaluationContext;
const Networks = bosh.manifest.Networks;
const Header = bosh.manifest.Header;
const Addons = bosh.manifest.Addons;

class DirectorManager extends BaseManager {
  constructor(plan) {
    super(plan);
    this.director = bosh.director;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
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

  findNetworkSegmentIndex(guid) {
    logger.info(`Finding network segment index of an existing deployment with instance id '${guid}'...`);
    return this
      .director
      .getDeploymentNameForInstanceId(guid)
      .then(deploymentName => this.getNetworkSegmentIndex(deploymentName))
      .tap(networkSegmentIndex => logger.info(`+-> Found network segment index '${networkSegmentIndex}'`));
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