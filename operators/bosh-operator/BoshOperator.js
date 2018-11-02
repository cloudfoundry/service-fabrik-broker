'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const BaseOperator = require('../BaseOperator');
const DirectorService = require('./DirectorService');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const config = require('../../common/config');
const DBManager = require('../../broker/lib/fabrik/DBManager');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const assert = require('assert');

/* jshint nonew:false */
new DBManager(); //to log events

class BoshOperator extends BaseOperator {
  init() {
    utils.initializeEventListener(config.internal, 'internal');
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
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: _.get(changeObjectBody, 'metadata.name'),
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            lastOperation: {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: CONST.SERVICE_BROKER_ERR_MSG
            },
            error: utils.buildErrorJson(err)
          }
        });
      });
  }

  _processCreate(changeObjectBody) {
    assert.ok(_.get(changeObjectBody, 'metadata.name'), `Argument 'metadata.name' is required to process the request`);
    assert.ok(_.get(changeObjectBody, 'spec.options'), `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(_.get(changeObjectBody, 'spec.options'));
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    logger.info('Creating deployment resource with the following options:', changedOptions);
    return DirectorService.createInstance(_.get(changeObjectBody, 'metadata.name'), changedOptions)
      .then(directorService => directorService.create(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
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
    assert.ok(_.get(changeObjectBody, 'metadata.name'), `Argument 'metadata.name' is required to process the request`);
    assert.ok(_.get(changeObjectBody, 'spec.options'), `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(_.get(changeObjectBody, 'spec.options'));
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    logger.info('Updating deployment resource with the following options:', changedOptions);
    return DirectorService.createInstance(_.get(changeObjectBody, 'metadata.name'), changedOptions)
      .then(directorService => directorService.update(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
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
    assert.ok(_.get(changeObjectBody, 'metadata.name'), `Argument 'metadata.name' is required to process the request`);
    assert.ok(_.get(changeObjectBody, 'spec.options'), `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(_.get(changeObjectBody, 'spec.options'));
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    logger.info('Deleting deployment resource with the following options:', changedOptions);
    return DirectorService.createInstance(_.get(changeObjectBody, 'metadata.name'), changedOptions)
      .then(directorService => directorService.delete(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: _.get(changeObjectBody, 'metadata.name'),
        status: {
          response: response,
          state: _.get(response, 'task_id') ? CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS : CONST.APISERVER.RESOURCE_STATE.WAITING
        }
      }))
      .catch(ServiceInstanceNotFound, () => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: _.get(changeObjectBody, 'metadata.name')
      }));
  }
}

module.exports = BoshOperator;