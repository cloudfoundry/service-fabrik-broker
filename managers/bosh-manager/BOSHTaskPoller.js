'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const config = require('../../common/config');
const DirectorService = require('./DirectorService');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const NotFound = errors.NotFound;
/* jshint unused:false */
const Conflict = errors.Conflict;

class BOSHTaskPoller {
  static start() {
    function poller(object, interval) {
      const response = JSON.parse(object.status.response);
      const changedOptions = JSON.parse(object.spec.options);
      logger.info('Getting operation status with the following options and response:', changedOptions, response);
      const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(object.metadata.selfLink);
      // If no lockedByPoller annotation then set annotation  with time
      // Else check timestamp if more than specific time than start polling and change lockedByPoller Ip
      return eventmesh.apiServerClient.getResource({
          resourceGroup: resourceDetails.resourceGroup,
          resourceType: resourceDetails.resourceType,
          resourceId: object.metadata.name,
        })
        .then((resource) => {
          const pollerAnnotation = resource.metadata.annotations.lockedByTaskPoller;
          logger.info(`pollerAnnotation is ${pollerAnnotation} current time is: ${new Date()}`);
          return Promise.try(() => {
            if (pollerAnnotation && (JSON.parse(pollerAnnotation).ip !== config.broker_ip) && (new Date() - new Date(JSON.parse(pollerAnnotation).lockTime) < (CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL + 2000))) { // cahnge this to 5000
              logger.debug(`Process with ip ${JSON.parse(pollerAnnotation).ip} is already polling for task`);
            } else {
              const patchBody = _.cloneDeep(resource);
              let metadata = patchBody.metadata;
              let currentAnnotations = metadata.annotations;
              let patchAnnotations = currentAnnotations ? currentAnnotations : {};
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
                .tap((resource) => logger.info(`Successfully acquired task poller lock for request with options: ${JSON.stringify(changedOptions)}\n` +
                  `Updated resource with poller annotations is: `, resource))
                .then(() => DirectorService.createDirectorService(object.metadata.name, changedOptions)
                  .then(boshService => boshService.lastOperation(response))
                  .tap(lastOperationValue => logger.info('last operation value is ', lastOperationValue))
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
                      clearInterval(interval);
                      BOSHTaskPoller.pollers[object.metadata.name] = false;
                    }
                  })]))
                  .catch(ServiceInstanceNotFound, () => {
                    if (response.type === 'delete') {
                      clearInterval(interval);
                      BOSHTaskPoller.pollers[object.metadata.name] = false;
                      return eventmesh.apiServerClient.deleteResource({
                        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
                        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
                        resourceId: object.metadata.name
                      });
                    } else {
                      //TODO set error field
                    }
                  })
                  /* jshint unused:false */
                  .catch(Conflict => {
                    logger.debug(`Not able to acquire poller processing lock, Request with is probably picked by other worker`);
                  }));
            }
          });
        })
        .catch((NotFound), () => {
          logger.debug(`Resource not found, clearing interval`);
          clearInterval(interval);
          BOSHTaskPoller.pollers[object.metadata.name] = false;
        });
    }

    function startPoller(event) {
      logger.debug('Received Director Event: ', event);
      if ((event.type === CONST.API_SERVER.WATCH_EVENT.ADDED || event.type === CONST.API_SERVER.WATCH_EVENT.MODIFIED) && !BOSHTaskPoller.pollers[event.object.metadata.name]) {
        logger.info('starting poller for deployment ', event.object.metadata.name);
        const interval = setInterval(() => poller(event.object, interval), CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL);
        BOSHTaskPoller.pollers[event.object.metadata.name] = true;
      } else if (event.type === CONST.API_SERVER.WATCH_EVENT.DELETED) {
        // logger.info('GETTING DELETE EVENT!!!!!!!!!!!!!!!!!!!! ', event.object);
      }
    }
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`;
    return eventmesh.apiServerClient.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, startPoller, queryString)
      .then(stream => {
        logger.info(`Successfully set watcher on director resources`);
        return setTimeout(() => {
          try {
            logger.info(`Refreshing stream after ${CONST.APISERVER.WATCHER_REFRESH_INTERVAL}`);
            stream.abort();
            return this.start();
          } catch (err) {
            logger.error('Error caught in the set timout callback for resource poller');
            throw err;
          }
        }, CONST.APISERVER.WATCHER_REFRESH_INTERVAL);
      })
      .catch(e => {
        logger.error('Failed registering watche on director resources with error:', e);
        throw e;
      });
  }
}

BOSHTaskPoller.pollers = [];
module.exports = BOSHTaskPoller;