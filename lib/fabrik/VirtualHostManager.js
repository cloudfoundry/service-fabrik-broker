const _ = require('lodash');
const Promise = require('bluebird');
const bosh = require('../bosh');
const utils = require('../utils');
const VirtualHostInstance = require('./VirtualHostInstance');
const BaseManager = require('./BaseManager');
const VirtualHostAgent = require('./VirtualHostAgent');
const logger = require('../logger');
const errors = require('../errors');
const NotImplemented = errors.NotImplemented;
const ServiceInstanceNotOperational = errors.ServiceInstanceNotOperational;
const BadRequest = errors.BadRequest;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const NotFound = errors.NotFound;
const mapper = require('./VirtualHostRelationMapper');

class VirtualHostManager extends BaseManager {

  constructor(plan) {
    super(plan);
    this.director = bosh.director;
    this.agent = new VirtualHostAgent(this.settings.agent);
    this.mapper = mapper.VirtualHostRelationMapper;
  }

  verifyFeatureSupport(feature) {
    if (!_.includes(this.agent.features, feature)) {
      throw new NotImplemented(`Feature '${feature}' not supported`);
    }
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
    return this.getDeploymentManifest(deploymentName)
      .tap(manifest => {
        if (_.isNil(manifest)) {
          throw new ServiceInstanceNotOperational(this.getInstanceGuid(deploymentName));
        }
      })
      .then(manifest => _
        .chain(manifest.jobs)
        .map(job => _.map(job.networks, net => net.static_ips))
        .flattenDeep()
        .value()
      );
  }

  createOrUpdateVirtualHost(deploymentName, params, guid) {
    this.verifyFeatureSupport('multi_tenancy');
    logger.info(`Creating virtual host for deployment '${deploymentName}'...`);
    return this.getDeploymentIps(deploymentName)
      .then(ips => this.agent.provision(ips, guid))
      .tap(() => this.saveVirtualHostInstanceToDeploymentRelation(deploymentName, guid))
      .catch(err => {
        logger.error('+-> Failed to create virtual host');
        logger.error(err);
        throw err;
      });
  }

  deleteVirtualHost(deploymentName, guid) {
    this.verifyFeatureSupport('multi_tenancy');
    logger.info(`deleting virtual host for deployment '${deploymentName}'...`);
    return this.getDeploymentIps(deploymentName)
      .then(ips => this.agent.deprovision(ips, guid))
      .tap(() => this.deleteVirtualHostInstanceToDeploymentRelation(deploymentName, guid))
      .catch(err => {
        logger.error('+-> Failed to delete virtual host');
        logger.error(err);
        throw err;
      });
  }

  createBinding(deploymentName, guid, binding) {
    this.verifyFeatureSupport('credentials');
    logger.info(`Creating binding '${binding.id}' for deployment '${deploymentName}', virtual host '${guid}'...`);
    logger.info('+-> Binding parameters:', binding.parameters);
    return this.getDeploymentIps(deploymentName)
      .then(ips => this.agent.createCredentials(ips, guid, binding.parameters))
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

  deleteBinding(deploymentName, guid, id) {
    this.verifyFeatureSupport('credentials');
    logger.info(`Deleting binding '${id}' for deployment '${deploymentName}' , virtual host '${guid}'...`);
    return Promise
      .all([
        this.getDeploymentIps(deploymentName),
        this.getBindingProperty(deploymentName, id)
      ])
      .spread((ips, binding) => this.agent.deleteCredentials(ips, guid, binding.credentials))
      .then(() => this.deleteBindingProperty(deploymentName, id))
      .tap(() => logger.info('+-> Deleted service binding'))
      .catch(err => {
        logger.error('+-> Failed to delete binding');
        logger.error(err);
        throw err;
      });
  }

  saveVirtualHostInstanceToDeploymentRelation(deploymentName, id) {
    return this.mapper
      .createVirtualHostRelation(deploymentName, `virtual_host_instance-${id}`)
      .catchThrow(BadRequest, new BadRequest(`Virtual host instance with ID ${id} already exists on deployment ${deploymentName}`));
  }

  deleteVirtualHostInstanceToDeploymentRelation(deploymentName, id) {
    return this.mapper
      .deleteVirtualHostRelation(`virtual_host_instance-${id}`)
      .catchThrow(BadRequest, new BadRequest(`Virtual host instance with ID ${id} does not exists on deployment ${deploymentName}`));
  }

  getLockProperty(deploymentName) {
    return this.director.getLockProperty(deploymentName);
  }

  createBindingProperty(deploymentName, id, value) {
    return this.director
      .createDeploymentProperty(deploymentName, `binding-${id}`, JSON.stringify(value))
      .catchThrow(BadRequest, new ServiceBindingAlreadyExists(id));
  }

  getBindingProperty(deploymentName, id) {
    return this.director
      .getDeploymentProperty(deploymentName, `binding-${id}`)
      .then(result => JSON.parse(result))
      .catchThrow(NotFound, new ServiceBindingNotFound(id));
  }

  deleteBindingProperty(deploymentName, id) {
    return this.director
      .deleteDeploymentProperty(deploymentName, `binding-${id}`);
  }

  static get instanceConstructor() {
    return VirtualHostInstance;
  }

  static load(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }
}
module.exports = VirtualHostManager;