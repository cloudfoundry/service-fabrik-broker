'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const utils = require('../../common/utils');
const BaseManager = require('../BaseManager');
const DockerService = require('./DockerService');
const assert = require('assert');

class DockerBindManager extends BaseManager {

  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND, validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
        if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
          return this._processBind(changeObjectBody);
        } else if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
          return this._processUnbind(changeObjectBody);
        }
      })
      .catch(err => {
        logger.error('Error occurred in processing request by DockerBindManager', err);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
          }
        });
      });
  }

  _processBind(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, `Argument 'metadata.name' is required to process the request`);
    assert.ok(changeObjectBody.metadata.labels.instance_guid, `Argument 'metadata.labels.instance_guid' is required to process the request`);
    assert.ok(changeObjectBody.spec.options, `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    const instance_guid = _.get(changeObjectBody, 'metadata.labels.instance_guid');
    logger.info('Triggering bind with the following options:', changedOptions);
    return DockerService.createInstance(instance_guid, changedOptions)
      .then(dockerService => dockerService.bind(changedOptions))
      .then(response => {
        const encodedResponse = utils.encodeBase64(response);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND,
          resourceId: changeObjectBody.metadata.name,
          status: {
            response: encodedResponse,
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
          }
        });
      });
  }
  _processUnbind(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, `Argument 'metadata.name' is required to process the request`);
    assert.ok(changeObjectBody.metadata.labels.instance_guid, `Argument 'metadata.labels.instance_guid' is required to process the request`);
    assert.ok(changeObjectBody.spec.options, `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    const instance_guid = _.get(changeObjectBody, 'metadata.labels.instance_guid');
    logger.info('Triggering docker unbind with the following options:', changedOptions);
    return DockerService.createInstance(instance_guid, changedOptions)
      .then(dockerService => dockerService.unbind(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER_BIND,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }
}

module.exports = DockerBindManager;