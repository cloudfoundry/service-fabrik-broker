'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const BaseInstance = require('./BaseInstance');
const logger = require('../../../common/logger');
const errors = require('../../../common/errors');
const NotFound = errors.NotFound;
const CONST = require('../../../common/constants');
const eventmesh = require('../../../data-access-layer/eventmesh');

class DirectorInstance extends BaseInstance {
  constructor(guid, manager) {
    super(guid, manager);
    this.networkSegmentIndex = undefined;
  }

  get platformContext() {
    return this.getContextFromResource()
      .then(context => {
        if (context) {
          return context;
        }
        return Promise.try(() => this.networkSegmentIndex ? this.deploymentName : this.manager.director.getDeploymentNameForInstanceId(this.guid))
        .then(deploymentName => this.manager.director.getDeploymentProperty(deploymentName, CONST.PLATFORM_CONTEXT_KEY))
        .then(context => JSON.parse(context))
        .catch(NotFound, () => {
          /* Following is to handle existing deployments. 
             For them platform-context is not saved in deployment property. Defaults to CF.
          */
          logger.warn(`Deployment property '${CONST.PLATFORM_CONTEXT_KEY}' not found for instance '${this.guid}'.\ 
          Setting default platform as '${CONST.PLATFORM.CF}'`);

          const context = {
            platform: CONST.PLATFORM.CF
          };
          return context;
        });
      });
  }
  
  getContextFromResource() {
    logger.debug(`Fetching context from etcd for ${this.guid}`);
    return eventmesh.apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: this.guid
      })
      .then(resource => {
        return _.get(resource, 'spec.options.context', undefined);
      })
      .catch(err => {
        logger.error(`Error occured while getting context from resource for instance ${this.guid} `, err);
        return;
      });
  }
  get deploymentName() {
    return this.manager.getDeploymentName(this.guid, this.networkSegmentIndex);
  }

  initialize(operation) {
    return Promise
      .try(() => {
        this.operation = operation.type;
        return this.manager.findNetworkSegmentIndex(this.guid);
      })
      .tap(networkSegmentIndex => {
        assert.ok(_.isInteger(networkSegmentIndex), `Network segment index '${networkSegmentIndex}' must be an integer`);
        this.networkSegmentIndex = networkSegmentIndex;
      });
  }

  getInfo() {
    const operation = {
      type: 'get'
    };
    return Promise
      .all([
        this.cloudController.getServiceInstance(this.guid),
        this.initialize(operation).then(() => this.manager.getDeploymentInfo(this.deploymentName))
      ])
      .spread((instance, deploymentInfo) => {
        return {
          title: `${this.plan.service.metadata.displayName || 'Service'} Dashboard`,
          plan: this.plan,
          service: this.plan.service,
          instance: _.set(instance, 'task', deploymentInfo),
          files: [{
            id: 'status',
            title: 'Status',
            language: 'yaml',
            content: yaml.dump(deploymentInfo)
          }]
        };
      });
  }
}

module.exports = DirectorInstance;