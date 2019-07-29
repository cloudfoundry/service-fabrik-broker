'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const CONST = require('../../common/constants');
const catalog = require('../../common/models').catalog;
const NotFound = errors.NotFound;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const Gone = errors.Gone;
const BaseService = require('../BaseService');
const cf = require('../../data-access-layer/cf');
const bosh = require('../../data-access-layer/bosh');
const VirtualHostAgent = require('./VirtualHostAgent');
const mapper = require('./VirtualHostRelationMapper');
const eventmesh = require('../../data-access-layer/eventmesh');

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
    if (operation && operation.type === CONST.OPERATION_TYPE.CREATE) {
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
      type: CONST.OPERATION_TYPE.CREATE
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
      .then(credentials =>  _.set(binding, 'credentials', credentials))
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
        this.getCredentials(bindingId)
      ])
      .spread((ips, credentials) => this.agent.deleteCredentials(ips, instanceId, credentials))
      .tap(() => logger.info('+-> Deleted service binding'))
      .catchThrow(NotFound, new ServiceBindingNotFound(bindingId));
  }

  getCredentials(id) {
    logger.info(`[getCredentials] making request to ApiServer for binding ${id}`);
    return utils.retry(tries => {
      logger.debug(`+-> Attempt ${tries + 1} to get binding ${id} from apiserver`);
      eventmesh.apiServerClient.getResponse({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND,
        resourceId: id
      })
      .then(response => {
          if (response) {
            return utils.decodeBase64(response);
          }
        })
    }, {
      maxAttempts: 5,
      minDelay: 1000
    })
    .catch(err => {
      logger.error(`[getCredentials] error while fetching resource for binding ${id} - `, err);
      throw err;
    })
  }

  /* Dashboard rendering functions */
  getInfo() {
    return this.initialize()
      .then(() => {
        this.parentInstanceId = this.getParentInstanceId();
        return Promise
          .all([
            eventmesh.apiServerClient.getResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST,
              resourceId: this.guid
            }),
            eventmesh.apiServerClient.getResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
              resourceId: this.parentInstanceId
            })
          ])
          .spread((instance, parent_instance) => {
            const parent_instance_plan = catalog.getPlan(_.get(parent_instance, 'spec.options.plan_id'));
            return {
              title: `${this.plan.service.metadata.displayName || 'Service'} Dashboard`,
              plan: this.plan,
              service: this.plan.service,
              instance: instance,
              parent_plan: parent_instance_plan,
              parent_instance: parent_instance
            };
          });
      });
  }

  getParentInstanceId() {
    return _.nth(_
      .chain(utils.deploymentNameRegExp().exec(this.deploymentName))
      .slice(1)
      .tap(parts => parts[1] = parts.length ? parseInt(parts[1]) : undefined)
      .value(), 2);
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
