'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const config = require('../../common/config');
const utils = require('../../common/utils');
const DirectorService = require('./DirectorService');
const EventLogInterceptor = require('../../common/EventLogInterceptor');
const BaseStatusPoller = require('../BaseStatusPoller');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const AssertionError = assert.AssertionError;

class BoshTaskStatusPoller extends BaseStatusPoller {
  constructor() {
    super({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
      validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED, CONST.API_SERVER.WATCH_EVENT.MODIFIED],
      pollInterval: CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL
    });
  }

  getStatus(resourceBody, intervalId) {
    let lastOperationOfInstance = {
      state: 'in progress',
      description: 'Update deployment is still in progress'
    };
    const instanceId = resourceBody.metadata.name;
    const options = _.get(resourceBody, 'spec.options');
    return DirectorService.createInstance(instanceId, options)
      .then(directorService => directorService.lastOperation(_.get(resourceBody, 'status.response'))
        .tap(lastOperationValue => logger.debug('last operation value is ', lastOperationValue))
        .tap(lastOperationValue => lastOperationOfInstance = lastOperationValue)
        .then(lastOperationValue => Promise.all([
          this._updateLastOperationStateInResource(instanceId, lastOperationValue, directorService, options),
          Promise.try(() => {
            if (_.includes([CONST.APISERVER.RESOURCE_STATE.SUCCEEDED, CONST.APISERVER.RESOURCE_STATE.FAILED], lastOperationValue.resourceState)) {
              // cancel the poller and clear the array
              this.clearPoller(instanceId, intervalId);
            }
          })
        ]))
        .catch(ServiceInstanceNotFound, err => {
          logger.error(`Error occured while getting last operation`, err);
          this.clearPoller(instanceId, intervalId);
          if (resourceBody.status.response.type === 'delete') {
            return eventmesh.apiServerClient.deleteResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
              resourceId: instanceId
            });
          } else {
            lastOperationOfInstance = {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: utils.getDefaultErrorMsg(err)
            };
            return eventmesh.apiServerClient.updateResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
              resourceId: instanceId,
              status: {
                lastOperation: lastOperationOfInstance,
                state: CONST.APISERVER.RESOURCE_STATE.FAILED,
                error: utils.buildErrorJson(err)
              },
              metadata: {
                annotations: {
                  deploymentIps: '{}'
                }
              }
            });
          }
        })
        .catch(AssertionError, err => {
          logger.error(`Error occured while getting last operation for instance ${instanceId}`, err);
          this.clearPoller(instanceId, intervalId);
          err.statusCode = CONST.ERR_STATUS_CODES.BOSH.BAD_FORMAT;
          lastOperationOfInstance = {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            description: utils.getDefaultErrorMsg(err)
          };
          return eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: instanceId,
            status: {
              lastOperation: lastOperationOfInstance,
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              error: utils.buildErrorJson(err)
            },
            metadata: {
              annotations: {
                deploymentIps: '{}'
              }
            }
          });
        })
        .finally(() => {
          if (_.get(resourceBody.status.response, 'type') === CONST.OPERATION_TYPE.UPDATE &&
            _.get(resourceBody.status.response, 'parameters.service-fabrik-operation') === true &&
            _.includes([CONST.APISERVER.RESOURCE_STATE.SUCCEEDED, CONST.APISERVER.RESOURCE_STATE.FAILED], lastOperationOfInstance.state)) {
            return this._logEvent(_.assign(options, {
              instance_id: instanceId
            }), lastOperationOfInstance, CONST.HTTP_METHOD.PATCH);
          }
        })
      );
  }

  _logEvent(opts, operationStatusResponse, method) {
    const eventLogger = EventLogInterceptor.getInstance(config.internal.event_type, 'internal');
    const check_res_body = true;
    const resp = {
      statusCode: 200,
      body: operationStatusResponse
    };
    if (CONST.URL.instance) {
      return eventLogger.publishAndAuditLogEvent(CONST.URL.instance, method, opts, resp, check_res_body);
    }
  }

  _updateLastOperationStateInResource(instanceId, lastOperationValue, directorService, options) {
    return Promise.try(() => {
      if (lastOperationValue.resourceState === CONST.APISERVER.RESOURCE_STATE.SUCCEEDED) {
        if (lastOperationValue.type === CONST.OPERATION_TYPE.CREATE ||
          lastOperationValue.type === CONST.OPERATION_TYPE.UPDATE) {
          return directorService.director.getDeploymentNameForInstanceId(directorService.guid)
            .then(deploymentName => directorService.director.getDeploymentIpsFromDirector(deploymentName))
            .then(ips => eventmesh.apiServerClient.updateResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
              resourceId: instanceId,
              status: {
                lastOperation: lastOperationValue,
                state: lastOperationValue.resourceState,
                appliedOptions: options
              },
              metadata: {
                annotations: {
                  deploymentIps: JSON.stringify(ips)
                }
              }
            }))
            .catch(err => {
              logger.error(`Error occurred while updating deployment IPs in apiserver for ${instanceId}. Erasing deploymentIPs in the resource.`, err);
              return eventmesh.apiServerClient.updateResource({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
                resourceId: instanceId,
                status: {
                  lastOperation: lastOperationValue,
                  state: lastOperationValue.resourceState
                },
                metadata: {
                  annotations: {
                    deploymentIps: '{}'
                  }
                }
              });
            });
        }
        if (lastOperationValue.type === CONST.OPERATION_TYPE.DELETE) {
          return eventmesh.apiServerClient.deleteResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: instanceId
          });
        }
      } else {
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: instanceId,
          status: {
            lastOperation: lastOperationValue,
            state: lastOperationValue.resourceState
          }
        });
      }
    });
  }
}

module.exports = BoshTaskStatusPoller;