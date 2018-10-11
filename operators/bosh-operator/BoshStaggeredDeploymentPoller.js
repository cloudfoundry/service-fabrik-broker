'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const DirectorService = require('./DirectorService');
const BaseStatusPoller = require('../BaseStatusPoller');
const DeploymentDelayed = errors.DeploymentDelayed;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const AssertionError = assert.AssertionError;

class BoshStaggeredDeploymentPoller extends BaseStatusPoller {
  constructor() {
    super({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      validStateList: [CONST.APISERVER.RESOURCE_STATE.WAITING],
      validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED, CONST.API_SERVER.WATCH_EVENT.MODIFIED],
      pollInterval: CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL
    });
  }

  getStatus(resourceBody, intervalId) {
    let deploymentName;
    let directorService;
    const instanceId = resourceBody.metadata.name;
    const resourceOptions = _.get(resourceBody, 'spec.options');
    return DirectorService
      .createInstance(instanceId, resourceOptions)
      .tap(directorInstance => directorService = directorInstance)
      .then(() => directorService.findDeploymentNameByInstanceId(instanceId))
      .tap(deployment_name => deploymentName = deployment_name)
      .then(() => directorService.createOrUpdateDeployment(deploymentName, resourceOptions))
      .then(directorResponse => {
        if (_.get(directorResponse, 'task_id')) {
          return Promise.all([eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: instanceId,
            status: {
              response: _.assign(resourceBody.status.response, directorResponse),
              state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
            }
          }), Promise.try(() => {
            // cancel the poller and clear the array
            this.clearPoller(instanceId, intervalId);
          })]);
        }
      })
      .catch(DeploymentDelayed, err => logger.warn(`Deployment further delayed for instance ${instanceId}`, err))
      .catch(AssertionError, ServiceInstanceNotFound, err => {
        logger.error(`Error occured while triggering deployment for instance ${instanceId}`, err);
        this.clearPoller(instanceId, intervalId);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: instanceId,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
          }
        });
      })
      //DeploymentDelayed is also captured below and no operation required from this poller
      // again it would be picked up by this poller.
      .catch(e => logger.error(`Error in scheduled of cached deployment ${deploymentName}`, e));
  }
}

module.exports = BoshStaggeredDeploymentPoller;