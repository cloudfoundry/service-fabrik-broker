const _ = require('lodash');
const Promise = require('bluebird');
const bosh = require('../bosh');
const utils = require('../utils');
const VirtualHostInstance = require('./VirtualHostInstance');
const BaseManager = require('./BaseManager');
const VirtualHostAgent = require('./VirtualHostAgent');
const logger = require('../logger');
const errors = require('../errors');
const BadRequest = errors.BadRequest;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const NotFound = errors.NotFound;
const mapper = require('./VirtualHostRelationMapper');

class VirtualHostManager extends BaseManager {
  constructor(plan) {
    super(plan);
    this.director = bosh.director;
    this.agent = new VirtualHostAgent(this.settings.agent);
    this.mapper = mapper.VirtualHostRelationMapper;
  }

  createVirtualHost(deploymentName, params, instanceId) {
    logger.info(`Creating virtual host for deployment '${deploymentName}'...`);
    return this.director.getDeploymentIps(deploymentName)
      .then(ips => this.agent.createVirtualHost(ips, instanceId))
      .then(() => this.mapper.createVirtualHostRelation(deploymentName, instanceId))
      .tap(() => logger.info(`+-> Created virtual host for deployment '${deploymentName}'`));
  }

  deleteVirtualHost(deploymentName, instanceId) {
    logger.info(`Deleting virtual host for deployment '${deploymentName}'...`);
    let instanceDeleted = true;
    return this.director.getDeploymentIps(deploymentName)
      .tap(() => instanceDeleted = false)
      .then(ips => Promise.all([this.agent.deleteVirtualHost(ips, instanceId),
        this.mapper.deleteVirtualHostRelation(instanceId)
      ]))
      .tap(() => logger.info(`+-> Deleted virtual host for deployment '${deploymentName}'`))
      .catch(NotFound, () => {
        if (instanceDeleted) {
          this.mapper.deleteVirtualHostRelation(instanceId);
        }
        throw new ServiceInstanceNotFound(instanceId);
      });
  }

  createBinding(deploymentName, instanceId, binding) {
    logger.info(`Creating binding '${binding.id}' with binding parameters ${binding.parameters} for deployment '${deploymentName}', virtual host '${instanceId}'...`);
    return this.director.getDeploymentIps(deploymentName)
      .then(ips => this.agent.createCredentials(ips, instanceId, binding.parameters))
      .then(credentials => this.createBindingProperty(deploymentName, binding.id, _.set(binding, 'credentials', credentials)))
      .then(() => binding.credentials)
      .tap(() => {
        const bindCreds = _.cloneDeep(binding.credentials);
        utils.maskSensitiveInfo(bindCreds);
        logger.info(`+-> Created binding:${JSON.stringify(bindCreds)}`);
      });
  }

  deleteBinding(deploymentName, instanceId, bindingId) {
    logger.info(`Deleting binding '${bindingId}' for deployment '${deploymentName}' , virtual host '${instanceId}'...`);
    return Promise
      .all([
        this.director.getDeploymentIps(deploymentName),
        this.getBindingProperty(deploymentName, bindingId)
      ])
      .spread((ips, binding) => this.agent.deleteCredentials(ips, instanceId, binding.credentials))
      .then(() => this.deleteBindingProperty(deploymentName, bindingId))
      .tap(() => logger.info('+-> Deleted service binding'))
      .catchThrow(NotFound, new ServiceBindingNotFound(bindingId));
  }

  createBindingProperty(deploymentName, bindingId, value) {
    return this.director
      .createDeploymentProperty(deploymentName, `binding-${bindingId}`, JSON.stringify(value))
      .catchThrow(BadRequest, new ServiceBindingAlreadyExists(bindingId));
  }

  getBindingProperty(deploymentName, bindingId) {
    return this.director
      .getDeploymentProperty(deploymentName, `binding-${bindingId}`)
      .then(result => JSON.parse(result));
  }

  deleteBindingProperty(deploymentName, bindingId) {
    return this.director.deleteDeploymentProperty(deploymentName, `binding-${bindingId}`);
  }

  static get instanceConstructor() {
    return VirtualHostInstance;
  }
}
module.exports = VirtualHostManager;