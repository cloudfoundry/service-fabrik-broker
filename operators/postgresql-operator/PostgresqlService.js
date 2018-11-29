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
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const BadRequest = errors.BadRequest;
const Gone = errors.Gone;
const BaseService = require('../BaseService');
const cf = require('../../data-access-layer/cf');
const bosh = require('../../data-access-layer/bosh');
const PostgresqlAgent = require('./PostgresqlAgent');
const eventmesh = require('../../data-access-layer/eventmesh');
class PostgresqlService extends BaseService {
  constructor(guid, spaceId, plan, parameters) {
    super(plan);
    this.guid = guid;
    this.spaceId = spaceId;
    this.plan = plan;
    this.parameters = parameters;
    this.director = bosh.director;
    this.cloudController = cf.cloudController;
    this.agent = new PostgresqlAgent(this.settings.agent);
  }

  initialize(operation) {
    // Maintaining and retrieving mapping of shared and dedicated instance
    if (operation.type === CONST.OPERATION_TYPE.CREATE) {
      // Storing deployment name of dedicated instance in logicaldb CRD
      return this.cloudController.getServiceInstanceByName(this.parameters.dedicated_postgresql_instance, this.spaceId)
        .then(serviceInstance => this.director.getDeploymentNameForInstanceId(serviceInstance.metadata.guid))
        .then(deploymentName => this.deploymentName = deploymentName)
        .then(() => eventmesh.apiServerClient.patchResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.LOGICALDB,
          resourceId: this.guid,
          operatorMetadata: {
            dedicatedInstanceDeploymentName: this.deploymentName
          }
        }));
    }
    // Set deployment name of dedicated instance 
    else if (operation.type === CONST.OPERATION_TYPE.DELETE || operation.type === CONST.OPERATION_TYPE.UPDATE) {
      return Promise.try(() => {
        this.deploymentName = operation.parameters.deploymentName;
        logger.info(`Dedicated instance deployment name is '${this.deploymentName}'...`);

      });
    }
    // Retrieve deployment name of dedicated instance from CRD
    else {
      return eventmesh.apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.LOGICALDB,
        resourceId: this.guid,
      }).then(resourcebody => {
        this.deploymentName = resourcebody.operatorMetadata.dedicatedInstanceDeploymentName;
        logger.info(`Dedicated instance deployment name is '${this.deploymentName}'...`);
      });
    }
  }

  create() {
    const operation = {
      type: CONST.OPERATION_TYPE.CREATE
    };
    return this.initialize(operation)
      .tap(() => logger.info(`Creating logical db '${this.guid}' for deployment '${this.deploymentName}'...`))
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .then(ips => this.agent.createDb(ips, this.guid, this.parameters))
      .tap(() => logger.info(`+-> Created logical db '${this.guid}' for deployment '${this.deploymentName}'`));
  }
  update(changedOptions) {
    const metadata = changedOptions.operatorMetadata;
    const operation = {
      type: 'update',
      parameters: {
        deploymentName: metadata.dedicatedInstanceDeploymentName
      }
    };
    return this.initialize(operation)
      .tap(() => logger.info(`Updating logical db '${this.guid}' for deployment '${this.deploymentName}'...`))
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .then(ips => this.agent.updateDb(ips, this.guid, this.parameters))
      .tap(() => logger.info(`+-> Updated logical db '${this.guid}' for deployment '${this.deploymentName}'`));
  }

  delete(changedOptions) {
    const metadata = changedOptions.operatorMetadata;
    const operation = {
      type: 'delete',
      parameters: {
        deploymentName: metadata.dedicatedInstanceDeploymentName
      }
    };
    let instanceDeleted = true;
    return this.initialize(operation)
      .tap(() => {
        logger.info(`Deleting logical db '${this.guid}' for deployment '${this.deploymentName}'...`);
        delete this.director.deploymentIpsCache[this.deploymentName];
      })
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .tap(() => instanceDeleted = false)
      .then(ips => Promise.all([this.agent.deleteDb(ips, this.guid)]))
      .tap(() => logger.info(`+-> Deleted logical db '${this.guid}' for deployment '${this.deploymentName}'`))
      .catch(NotFound, () => {
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
    logger.info(`Creating binding '${binding.id}' with binding parameters '${binding.parameters}' for deployment '${deploymentName}', instance '${instanceId}'...`);
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
    logger.info(`Deleting binding '${bindingId}' for deployment '${deploymentName}' , instance '${instanceId}'...`);
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

  static createPostgresqlService(instanceId, options) {
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const spaceId = _.get(options, 'context.space_guid');
    const parameters = _.get(options, 'parameters');
    const postgresqlService = new PostgresqlService(instanceId, spaceId, plan, parameters);
    return Promise.resolve(postgresqlService);
  }
}

module.exports = PostgresqlService;