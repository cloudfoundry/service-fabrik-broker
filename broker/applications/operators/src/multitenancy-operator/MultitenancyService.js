'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    NotFound,
    Gone
  }
} = require('@sf/common-utils');
const { catalog } = require('@sf/models');
const BaseService = require('../../../../core/provisioner-services/src/BaseService');
const { cloudController } = require('@sf/cf');
const { director } = require('@sf/bosh');
const { apiServerClient } = require('@sf/eventmesh');
const MultitenancyAgent = require('./MultitenancyAgent');

class MultitenancyService extends BaseService {
  constructor(guid, spaceId, plan, parameters, resourceType) {
    super(plan);
    this.guid = guid;
    this.spaceId = spaceId;
    this.parameters = parameters;
    this.director = director;
    this.cloudController = cloudController;
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
      type: CONST.OPERATION_TYPE.UPDATE,
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
      type: CONST.OPERATION_TYPE.DELETE,
      parameters: {
        deploymentName: changedOptions.operatorMetadata.dedicatedInstanceDeploymentName
      }
    };
    let instanceDeleted = true; // eslint-disable-line no-unused-vars
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
    return apiServerClient.patchResource({
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
    assert.ok(_.get(options, 'context.space_guid'), 'Argument \'options.context.space_guid\' is required to process the request');
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const spaceId = _.get(options, 'context.space_guid');
    const parameters = _.get(options, 'parameters');
    const multitenancyService = new MultitenancyService(instanceId, spaceId, plan, parameters, resourceType);
    return Promise.resolve(multitenancyService);
  }
}

module.exports = MultitenancyService;
