'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const catalog = require('../../common/models').catalog;
const NotFound = errors.NotFound;
const Gone = errors.Gone;
const BaseService = require('../BaseService');
const cf = require('../../data-access-layer/cf');
const bosh = require('../../data-access-layer/bosh');
const MultitenancyAgent = require('./MultitenancyAgent');
const eventmesh = require('../../data-access-layer/eventmesh');

class MultitenancyService extends BaseService {
  constructor(guid, spaceId, plan, parameters, resourceType) {
    super(plan);
    this.guid = guid;
    this.spaceId = spaceId;
    this.parameters = parameters;
    this.director = bosh.director;
    this.cloudController = cf.cloudController;
    this.resourceType = resourceType;
    this.agent = new MultitenancyAgent(this.settings.agent);
  }

  initialize(operation) {
    if (operation.type === CONST.OPERATION_TYPE.CREATE) {
      return this.cloudController.getServiceInstanceByName(this.parameters.dedicated_instance, this.spaceId)
        .then(serviceInstance => this.director.getDeploymentNameForInstanceId(serviceInstance.metadata.guid))
        .then(deploymentName => this.deploymentName = deploymentName);
    } else if (operation.type === CONST.OPERATION_TYPE.DELETE || operation.type === CONST.OPERATION_TYPE.UPDATE) {
      return Promise.try(() => {
        this.deploymentName = operation.parameters.deploymentName;
        logger.debug(`Dedicated instance deployment name is '${this.deploymentName}'...`);
      });
    }
  }

  create() {
    const operation = {
      type: CONST.OPERATION_TYPE.CREATE
    };
    return this.initialize(operation)
      .tap(() => logger.info(`Creating resource '${this.guid}' of type '${this.resourceType}' on dedicated deployment '${this.deploymentName}'...`))
      .then(() => this.storeDedicatedInstanceDeploymentName(this.deploymentName, this.guid))
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .then(ips => this.agent.createTenant(ips, this.guid, this.parameters))
      .tap(() => logger.info(`+-> Created resource'${this.guid}' of type '${this.resourceType}' on dedicated deployment  '${this.deploymentName}'`));
  }

  update(changedOptions) {
    const operation = {
      type: 'update',
      parameters: {
        deploymentName: changedOptions.operatorMetadata.dedicatedInstanceDeploymentName
      }
    };
    return this.initialize(operation)
      .tap(() => logger.info(`Updating resource'${this.guid}' of type '${this.resourceType}' on dedicated deployment '${this.deploymentName}'...`))
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .then(ips => this.agent.updateTenant(ips, this.guid, this.parameters))
      .tap(() => logger.info(`+-> Updated resource '${this.guid}' of type '${this.resourceType}' on dedicated deployment '${this.deploymentName}'`));
  }

  delete(changedOptions) {
    const operation = {
      type: 'delete',
      parameters: {
        deploymentName: changedOptions.operatorMetadata.dedicatedInstanceDeploymentName
      }
    };
    let instanceDeleted = true;
    return this.initialize(operation)
      .tap(() => logger.info(`Deleting resource '${this.guid}' of type '${this.resourceType}' on dedicated deployment '${this.deploymentName}'...`))
      .then(() => this.director.getDeploymentIps(this.deploymentName))
      .tap(() => instanceDeleted = false)
      .then(ips => Promise.all([this.agent.deleteTenant(ips, this.guid)]))
      .tap(() => logger.info(`+-> Deleted resource '${this.guid}' of type '${this.resourceType}' on dedicated deployment '${this.deploymentName}'`))
      .catch(NotFound, () => {
        throw new Gone(this.guid);
      });
  }


  storeDedicatedInstanceDeploymentName() {
    return eventmesh.apiServerClient.patchResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: this.resourceType,
      resourceId: this.guid,
      operatorMetadata: {
        dedicatedInstanceDeploymentName: this.deploymentName
      }
    });
  }

  static createInstance(instanceId, options, resourceType) {
    assert.ok(options.plan_id, 'Plan ID must be available');
    assert.ok(_.get(options, 'context.space_guid'), `Argument 'options.context.space_guid' is required to process the request`);
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const spaceId = _.get(options, 'context.space_guid');
    const parameters = _.get(options, 'parameters');
    const multitenancyService = new MultitenancyService(instanceId, spaceId, plan, parameters, resourceType);
    return Promise.resolve(multitenancyService);
  }
}

module.exports = MultitenancyService;