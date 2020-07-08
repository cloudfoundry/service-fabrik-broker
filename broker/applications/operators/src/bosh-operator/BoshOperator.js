'use strict';

const Promise = require('bluebird');
const assert = require('assert');
const _ = require('lodash');

const { apiServerClient } = require('@sf/eventmesh');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    ServiceInstanceNotFound
  },
  commonFunctions: {
    buildErrorJson,
    getDefaultErrorMsg
  }
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const { initializeEventListener } = require('@sf/event-logger');
const BaseOperator = require('../BaseOperator');
const DirectorService = require('@sf/provisioner-services').DirectorService;
require('@sf/db');

class BoshOperator extends BaseOperator {
  init() {
    initializeEventListener(config.internal, 'internal');
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.UPDATE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
      switch (_.get(changeObjectBody, 'status.state')) {
        case CONST.APISERVER.RESOURCE_STATE.IN_QUEUE:
          return this._processCreate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.UPDATE:
          return this._processUpdate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.DELETE:
          return this._processDelete(changeObjectBody);
        default:
          logger.error('Ideally it should never come to default state! There must be some error as the state is ', _.get(changeObjectBody, 'status.state'));
          break;
      }
    })
      .catch(err => {
        logger.error('Error occurred in processing request by BoshOperator', err);
        return apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: _.get(changeObjectBody, 'metadata.name'),
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            lastOperation: {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: getDefaultErrorMsg(err)
            },
            response: {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: getDefaultErrorMsg(err)
            },
            error: buildErrorJson(err)
          }
        });
      });
  }

  _processCreate(changeObjectBody) {
    assert.ok(_.get(changeObjectBody, 'metadata.name'), 'Argument \'metadata.name\' is required to process the request');
    assert.ok(_.get(changeObjectBody, 'spec.options'), 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(_.get(changeObjectBody, 'spec.options'));
    assert.ok(changedOptions.plan_id, 'Argument \'spec.options\' should have an argument plan_id to process the request');
    logger.info('Creating deployment resource with the following options:', changedOptions);
    return DirectorService.createInstance(_.get(changeObjectBody, 'metadata.name'), changedOptions)
      .then(directorService => directorService.create(changedOptions))
      .then(response => apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: _.get(changeObjectBody, 'metadata.name'),
        status: {
          response: response,
          state: _.get(response, 'task_id') ? CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS : CONST.APISERVER.RESOURCE_STATE.WAITING
        }
      }));
  }

  _processUpdate(changeObjectBody) {
    assert.ok(_.get(changeObjectBody, 'metadata.name'), 'Argument \'metadata.name\' is required to process the request');
    assert.ok(_.get(changeObjectBody, 'spec.options'), 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(_.get(changeObjectBody, 'spec.options'));
    assert.ok(changedOptions.plan_id, 'Argument \'spec.options\' should have an argument plan_id to process the request');
    logger.info('Updating deployment resource with the following options:', changedOptions);
    return DirectorService.createInstance(_.get(changeObjectBody, 'metadata.name'), changedOptions)
      .then(directorService => directorService.update(changedOptions))
      .then(response => apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: _.get(changeObjectBody, 'metadata.name'),
        status: {
          response: response,
          state: _.get(response, 'task_id') ? CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS : CONST.APISERVER.RESOURCE_STATE.WAITING
        }
      }));
  }

  _processDelete(changeObjectBody) {
    assert.ok(_.get(changeObjectBody, 'metadata.name'), 'Argument \'metadata.name\' is required to process the request');
    assert.ok(_.get(changeObjectBody, 'spec.options'), 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(_.get(changeObjectBody, 'spec.options'));
    assert.ok(changedOptions.plan_id, 'Argument \'spec.options\' should have an argument plan_id to process the request');
    logger.info('Deleting deployment resource with the following options:', changedOptions);
    return DirectorService.createInstance(_.get(changeObjectBody, 'metadata.name'), changedOptions)
      .then(directorService => directorService.delete(changedOptions))
      .then(response => apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: _.get(changeObjectBody, 'metadata.name'),
        status: {
          response: response,
          state: _.get(response, 'task_id') ? CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS : CONST.APISERVER.RESOURCE_STATE.WAITING
        }
      }))
      .catch(ServiceInstanceNotFound, () => apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: _.get(changeObjectBody, 'metadata.name')
      }));
  }
}

module.exports = BoshOperator;
