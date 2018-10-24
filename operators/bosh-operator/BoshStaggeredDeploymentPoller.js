'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const DirectorService = require('./DirectorService');
const BaseStatusPoller = require('../BaseStatusPoller');

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
    const instanceId = resourceBody.metadata.name;
    const resourceOptions = _.get(resourceBody, 'spec.options');
    const deploymentName = _.get(resourceBody, 'status.response.deployment_name');
    return DirectorService
      .createInstance(instanceId, resourceOptions)
      .then(directorService => {
        if (deploymentName) {
          return directorService.createOrUpdateDeployment(deploymentName, resourceOptions);
        } else {
          const type = _.get(resourceBody, 'status.response.type');
          if (type === CONST.OPERATION_TYPE.CREATE) {
            return directorService.create(resourceOptions);
          } else if (type === CONST.OPERATION_TYPE.UPDATE) {
            return directorService.update(resourceOptions);
          }
        }
      })
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
      .catch(err => {
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
      });
  }
}

module.exports = BoshStaggeredDeploymentPoller;