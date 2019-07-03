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
    const deploymentName = _.get(resourceBody, 'status.response.deployment_name');
    const operationType = _.get(resourceBody, 'status.response.type');
    return DirectorService
      .createInstance(instanceId, resourceOptions)
      .then(directorService => directorService.getAgentPostProcessingStatus(operationType, deploymentName))
      .tap(postProcessingState => logger.debug('post processing state is ', postProcessingState))
      .then(status => Promise.all([eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: instanceId,
        status: {
          // TODO set response? set description?
          // response: _.assign(resourceBody.status.response, directorResponse),
          state: status.state
        }
      }), Promise.try(() => {
        // cancel the poller and clear the array
        if (_.includes([CONST.APISERVER.RESOURCE_STATE.SUCCEEDED, CONST.APISERVER.RESOURCE_STATE.FAILED], status.state)) {
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
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: `${operationType} deployment ${deploymentName} failed at ${timestamp} with Error "${err.message}"`
            },
            error: utils.buildErrorJson(err)
          }
        });
      });

  }
}

module.exports = BoshPostProcessingPoller;
