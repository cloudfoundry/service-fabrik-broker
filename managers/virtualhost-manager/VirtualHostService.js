'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const catalog = require('../../common/models').catalog;
const NotFound = errors.NotFound;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const BadRequest = errors.BadRequest;
const Gone = errors.Gone;
const BaseService = require('../BaseService');
const cf = require('../../data-access-layer/cf');
const bosh = require('../../data-access-layer/bosh');
const VirtualHostAgent = require('./VirtualHostAgent');
const mapper = require('./VirtualHostRelationMapper');

class VirtualHostService extends BaseService {
  constructor(guid, spaceId, plan, parameters) {
    super(plan);
    this.guid = guid;
    this.spaceId = spaceId;
    this.plan = plan;
    this.parameters = parameters;
    this.director = bosh.director;
    this.cloudController = cf.cloudController;
    this.agent = new VirtualHostAgent(this.settings.agent);
    this.mapper = mapper.VirtualHostRelationMapper;
  }

  initialize(operation) {
    if (operation.type === 'create') {
      return this.cloudController.getServiceInstanceByName(this.parameters.dedicated_rabbitmq_instance, this.spaceId)
        .then(serviceInstance => this.director.getDeploymentNameForInstanceId(serviceInstance.metadata.guid))
        .then(deploymentName => this.deploymentName = deploymentName);
    } else {
      return this.mapper.getDeploymentName(`${this.guid}`)
        .then(deploymentName => this.deploymentName = deploymentName);
    }
  }

  create() {
    const operation = {
      type: 'create'
    };
    return this.initialize(operation)
      .tap(() => logger.info(`Creating virtual host '${this.guid}' for deployment '${this.deploymentName}'...`))
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .then(ips => this.agent.createVirtualHost(ips, this.guid, this.parameters))
      .then(() => this.mapper.createVirtualHostRelation(this.deploymentName, this.guid))
      .tap(() => logger.info(`+-> Created virtual host '${this.guid}' for deployment '${this.deploymentName}'`));
  }

  update() {
    const operation = {
      type: 'update'
    };
    return this.initialize(operation)
      .tap(() => logger.info(`Updating virtual host '${this.guid}' for deployment '${this.deploymentName}'...`))
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .then(ips => this.agent.updateVirtualHost(ips, this.guid, this.parameters))
      .tap(() => logger.info(`+-> Updated virtual host '${this.guid}' for deployment '${this.deploymentName}'`));
  }

  delete() {
    const operation = {
      type: 'delete'
    };
    let instanceDeleted = true;
    return this.initialize(operation)
      .tap(() => {
        logger.info(`Deleting virtual host '${this.guid}' for deployment '${this.deploymentName}'...`);
        delete this.director.deploymentIpsCache[this.deploymentName];
      })
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .tap(() => instanceDeleted = false)
      .then(ips => Promise.all([this.agent.deleteVirtualHost(ips, this.guid),
        this.mapper.deleteVirtualHostRelation(this.guid)
      ]))
      .tap(() => logger.info(`+-> Deleted virtual host '${this.guid}' for deployment '${this.deploymentName}'`))
      .catch(NotFound, () => {
        if (instanceDeleted) {
          this.mapper.deleteVirtualHostRelation(this.guid);
        }
        throw new Gone(this.guid);
      });
  }

  bind(params) {
    const operation = {
      type: 'bind'
    };
    return this.initialize(operation)
      .then(() => this.createBinding(this.deploymentName, this.guid, {
        id: params.binding_id,
        parameters: params.parameters || {}
      }));
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

  unbind(params) {
    const operation = {
      type: 'unbind'
    };
    return this.initialize(operation)
      .then(() => this.deleteBinding(this.deploymentName, this.guid, params.binding_id));
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

  static createVirtualHostService(instanceId, options) {
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const spaceId = _.get(options, 'context.space_guid');
    const parameters = _.get(options, 'parameters');
    const virtualHostService = new VirtualHostService(instanceId, spaceId, plan, parameters);
    return Promise.resolve(virtualHostService);
  }
}

module.exports = VirtualHostService;