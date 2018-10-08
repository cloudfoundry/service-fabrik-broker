'use strict';

const _ = require('lodash');
const DirectorService = require('../../../managers/bosh-manager/DirectorService');
const logger = require('../../../common/logger');
const CONST = require('../../../common/constants');
const eventmesh = require('../../../data-access-layer/eventmesh');
const TIME_POLL = 1 * 60 * 1000;

class DirectorTaskPoller {
  constructor(opts) {
    this.timeInterval = opts.time_interval || TIME_POLL;
  }

  start() {
    if (this.interval) {
      throw new Error('Timer already started for DirectorTaskPoller');
    }
    this.interval = setInterval(() => {
      return this.triggerStaggeredDeployments();
    }, this.timeInterval);
  }

  triggerStaggeredDeployments() {

    return eventmesh.apiServerClient
      .getResourceListByState({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        stateList: [CONST.APISERVER.RESOURCE_STATE.IN_CACHE]
      })
      .mapSeries(resource => {
        let deploymentName;
        let directorService;
        const resourceOptions = _.get(resource, 'spec.options');
        const instanceId = _.get(resource, 'metadata.name');
        return DirectorService
          .createInstance(instanceId, resourceOptions)
          .tap(directorInstance => directorService = directorInstance)
          .then(() => directorService.findDeploymentNameByInstanceId(instanceId))
          .tap(deployment_name => deploymentName = deployment_name)
          .then(() => directorService.createOrUpdateDeployment(deploymentName, resourceOptions))
          .then(directorResponse => eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: resource.metadata.name,
            status: {
              response: _.assign(resource.status.response, directorResponse),
              state: _.get(directorResponse, 'task_id') ? CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS : CONST.APISERVER.RESOURCE_STATE.IN_CACHE
            }
          }))
          .catch(e => logger.error(`Error in scheduled deployment operation for ${deploymentName}`, e));
      })
      .catch(e => logger.error('Error in processing deployments', e));
  }

  /**
   * Gets the interval object created by the NodeJS engine for the interval timer
   */
  get timer() {
    return this.interval;
  }

  /**
   * Stops the timer
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}

module.exports = DirectorTaskPoller;