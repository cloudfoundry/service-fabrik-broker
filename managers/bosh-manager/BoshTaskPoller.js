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
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const AssertionError = assert.AssertionError;
const Conflict = errors.Conflict;

class BoshTaskPoller {
  static start() {
    function poller(object, intervalId) {
      const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(object.metadata.selfLink);
      // If no lockedByPoller annotation then set annotation  with time
      // Else check timestamp if more than specific time than start polling and change lockedByPoller Ip
      return eventmesh.apiServerClient.getResource({
          resourceGroup: resourceDetails.resourceGroup,
          resourceType: resourceDetails.resourceType,
          resourceId: object.metadata.name,
        })
        .then(resourceBody => {
          const options = _.get(resourceBody, 'spec.options');
          const pollerAnnotation = _.get(resourceBody, 'metadata.annotations.lockedByTaskPoller');
          logger.debug(`pollerAnnotation is ${pollerAnnotation} current time is: ${new Date()}`);
          return Promise.try(() => {
            // If task is not picked by poller which has the lock on task for CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL + DIRECTOR_RESOURCE_POLLER_RELAXATION_TIME then try to acquire lock
            if (pollerAnnotation && (JSON.parse(pollerAnnotation).ip !== config.broker_ip) && (new Date() - new Date(JSON.parse(pollerAnnotation).lockTime) < (CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL + CONST.DIRECTOR_RESOURCE_POLLER_RELAXATION_TIME))) { // cahnge this to 5000
              logger.debug(`Process with ip ${JSON.parse(pollerAnnotation).ip} is already polling for task`);
            } else {
              const patchBody = _.cloneDeep(resourceBody);
              const metadata = patchBody.metadata;
              const currentAnnotations = metadata.annotations;
              const patchAnnotations = currentAnnotations ? currentAnnotations : {};
              patchAnnotations.lockedByTaskPoller = JSON.stringify({
                lockTime: new Date(),
                ip: config.broker_ip
              });
              metadata.annotations = patchAnnotations;
              // Handle conflict also
              return eventmesh.apiServerClient.updateResource({
                  resourceGroup: resourceDetails.resourceGroup,
                  resourceType: resourceDetails.resourceType,
                  resourceId: metadata.name,
                  metadata: metadata
                })
                .tap((updatedResource) => logger.debug(`Successfully acquired bosh task poller lock for request with options: ${JSON.stringify(options)}\n` +
                  `Updated resource with poller annotations is: `, updatedResource))
                .then(() => {
                  if (resourceBody.status.state !== CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS) {
                    BoshTaskPoller.clearPoller(metadata.name, intervalId);
                  } else {
                    return DirectorService.createInstance(metadata.name, options)
                      .then(directorService => directorService.lastOperation(_.get(resourceBody, 'status.response')))
                      .tap(lastOperationValue => logger.debug('last operation value is ', lastOperationValue))
                      .then(lastOperationValue => Promise.all([eventmesh.apiServerClient.updateResource({
                        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
                        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
                        resourceId: metadata.name,
                        status: {
                          lastOperation: lastOperationValue,
                          state: lastOperationValue.resourceState
                        }
                      }), Promise.try(() => {
                        if (_.includes([CONST.APISERVER.RESOURCE_STATE.SUCCEEDED, CONST.APISERVER.RESOURCE_STATE.FAILED], lastOperationValue.resourceState)) {
                          // cancel the poller and clear the array
                          BoshTaskPoller.clearPoller(metadata.name, intervalId);
                        }
                      })]))
                      .catch(ServiceInstanceNotFound, err => {
                        logger.error(`Error occured while getting last operation`, err);
                        BoshTaskPoller.clearPoller(metadata.name, intervalId);
                        if (resourceBody.status.response.type === 'delete') {
                          return eventmesh.apiServerClient.deleteResource({
                            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
                            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
                            resourceId: metadata.name
                          });
                        } else {
                          return eventmesh.apiServerClient.updateResource({
                            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
                            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
                            resourceId: metadata.name,
                            status: {
                              lastOperation: {
                                state: CONST.APISERVER.RESOURCE_STATE.FAILED,
                                description: CONST.SERVICE_BROKER_ERR_MSG
                              },
                              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
                              error: utils.buildErrorJson(err)
                            }
                          });
                        }
                      })
                      .catch(AssertionError, err => {
                        logger.error(`Error occured while getting last operation for instance ${object.metadata.name}`, err);
                        BoshTaskPoller.clearPoller(metadata.name, intervalId);
                        return eventmesh.apiServerClient.updateResource({
                          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
                          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
                          resourceId: metadata.name,
                          status: {
                            lastOperation: {
                              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
                              description: CONST.SERVICE_BROKER_ERR_MSG
                            },
                            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
                            error: utils.buildErrorJson(err)
                          }
                        });
                      });
                  }
                })
                .catch(Conflict, () => {
                  logger.debug(`Not able to acquire bosh task poller processing lock for instance ${object.metadata.name}, Request is probably picked by other worker`);
                });
            }
          });
        })
        .catch(err => {
          logger.error(`Error occured while polling for last operation for instance ${object.metadata.name}, clearing bosh task poller interval now`, err);
          BoshTaskPoller.clearPoller(object.metadata.name, intervalId);
        });
    }

    function startPoller(event) {
      logger.debug('Received Director Event: ', event);
      if ((event.type === CONST.API_SERVER.WATCH_EVENT.ADDED || event.type === CONST.API_SERVER.WATCH_EVENT.MODIFIED) && !BoshTaskPoller.pollers[event.object.metadata.name]) {
        logger.debug('starting bosh task poller for deployment ', event.object.metadata.name);
        // Poller time should be little less than watch refresh interval as 
        const intervalId = setInterval(() => poller(event.object, intervalId), CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL);
        BoshTaskPoller.pollers[event.object.metadata.name] = intervalId;
      }
    }
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`;
    return eventmesh.apiServerClient.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, startPoller, queryString)
      .then(stream => {
        logger.debug(`Successfully set watcher on director resources for task polling with query string:`, queryString);
        return Promise
          .delay(CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL)
          .then(() => {
            logger.debug(`Refreshing stream after ${CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL}`);
            stream.abort();
            return this.start();
          });
      })
      .catch(err => {
        logger.error(`Error occured in registering watch for bosh task poller:`, err);
        return Promise
          .delay(CONST.APISERVER.WATCHER_ERROR_DELAY)
          .then(() => {
            logger.debug(`Refreshing stream after ${CONST.APISERVER.WATCHER_ERROR_DELAY}`);
            return this.start();
          });
      });
  }

  static clearPoller(resourceId, intervalId) {
    logger.debug(`Clearing bosh task poller interval for deployment`, resourceId);
    if (intervalId) {
      clearInterval(intervalId);
    }
    _.unset(BoshTaskPoller.pollers, resourceId);
  }
}

BoshTaskPoller.pollers = [];
module.exports = BoshTaskPoller;