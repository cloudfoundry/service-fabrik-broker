'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const DirectorService = require('./DirectorService');
const BaseStatusPoller = require('../BaseStatusPoller');

class BoshPostProcessingPoller extends BaseStatusPoller {
  constructor() {
    super({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      validStateList: [CONST.APISERVER.RESOURCE_STATE.POST_PROCESSING],
      validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED, CONST.API_SERVER.WATCH_EVENT.MODIFIED],
      pollInterval: CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL
    });
  }

  getStatus(resourceBody, intervalId) {
    const instanceId = resourceBody.metadata.name;
    const resourceOptions = _.get(resourceBody, 'spec.options');
    const deploymentName = _.get(resourceBody, 'status.lastOperation.deployment_name');
    const operationType = _.get(resourceBody, 'status.lastOperation.type');
    const description = _.get(resourceBody, 'status.lastOperation.description');
    // only modify create and update operations
    if (!_.includes(['create', 'update'], operationType)) {
      return Promise.resolve({});
    }
    return DirectorService
      .createInstance(instanceId, resourceOptions)
      .then(directorService => directorService.getAgentLifecyclePostProcessingStatus(operationType, deploymentName))
      .tap(agentResponse => logger.debug('agent response is ', agentResponse))
      .then(agentResponse => Promise.all([eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: instanceId,
        status: {
          lastOperation: _.assign(resourceBody.status.lastOperation, {
            resourceState: agentResponse.state,
            description: _.get(agentResponse, 'description', description)
          }),
          state: agentResponse.state
        }
      }), Promise.try(() => {
        // cancel the poller and clear the array
        if (_.includes([CONST.APISERVER.RESOURCE_STATE.SUCCEEDED, CONST.APISERVER.RESOURCE_STATE.FAILED], agentResponse.state)) {
          this.clearPoller(instanceId, intervalId);
        }
      })]))
      .catch(err => {
        logger.error(`Error occurred while post processing deployment for instance ${instanceId}`, err);
        const timestamp = new Date().toISOString();
        this.clearPoller(instanceId, intervalId);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: instanceId,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            lastOperation: {
              resourceState: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: `Postprocessing of ${operationType} deployment ${deploymentName} failed at ${timestamp} with Error "${err.message}"`
            },
            error: utils.buildErrorJson(err)
          }
        });
      });

  }
}

module.exports = BoshPostProcessingPoller;
