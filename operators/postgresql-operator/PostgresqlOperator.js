'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const CONST = require('../../common/constants');
const BaseOperator = require('../BaseOperator');
const PostgresqlService = require('./PostgresqlService');
const errors = require('../../common/errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;

class PostgresqlOperator extends BaseOperator {

  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.UPDATE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
        switch (changeObjectBody.status.state) {
        case CONST.APISERVER.RESOURCE_STATE.IN_QUEUE:
          return this._processCreate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.DELETE:
          return this._processDelete(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.UPDATE:
          return this._processUpdate(changeObjectBody);
        default:
          logger.error('Ideally it should never come to default state! There must be some error as the state is ', changeObjectBody.status.state);
          break;
        }
      })
      .catch(Error, (err) => {
        logger.error('Error occurred in processing request by PostgresqlOperator', err);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.LOGICALDB,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
          }
        });
      });
  }

  _processCreate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering logical Db create with the following options:', changedOptions);
    return PostgresqlService.createPostgresqlService(changeObjectBody.metadata.name, changedOptions)
      .then(postgresqlService => postgresqlService.create())
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.LOGICALDB,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }
  _processDelete(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering logicalDb delete with the following options:', changeObjectBody);
    return PostgresqlService.createPostgresqlService(changeObjectBody.metadata.name, changedOptions)
      .then(postgresqlService => postgresqlService.delete(changeObjectBody))
      .then(() => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.LOGICALDB,
        resourceId: changeObjectBody.metadata.name,
      }))
      .catch(ServiceInstanceNotFound, () => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.LOGICALDB,
        resourceId: changeObjectBody.metadata.name
      }));
  }

  _processUpdate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering logicalDb update with the following options:', changedOptions);
    return PostgresqlService.createPostgresqlService(changeObjectBody.metadata.name, changedOptions)
      .then(postgresqlService => postgresqlService.update(changeObjectBody))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.LOGICALDB,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }
}

module.exports = PostgresqlOperator;