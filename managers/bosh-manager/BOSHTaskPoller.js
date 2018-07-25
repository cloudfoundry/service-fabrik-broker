'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const DirectorService = require('./DirectorService');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;

class BOSHTaskPoller {
  static start() {
    function poller(object, interval) {
      const response = JSON.parse(object.status.response);
      const changedOptions = JSON.parse(object.spec.options);
      logger.info('Getting operation status with the following options and response:', changedOptions, response);
      return DirectorService.createDirectorService(object.metadata.name, changedOptions)
        .then(boshService => boshService.lastOperation(response))
        .tap(lastOperationValue => logger.info('last operation value is ', lastOperationValue))
        .then(lastOperationValue => Promise.all([eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: object.metadata.name,
          status: {
            lastOperation: lastOperationValue,
            state: lastOperationValue.resourceState
          }
        }), Promise.try(() => {
          if (_.includes([CONST.APISERVER.RESOURCE_STATE.SUCCEEDED, CONST.APISERVER.RESOURCE_STATE.FAILED], lastOperationValue.resourceState)) {
            //cancel the poller and clear the array
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
        });
    }

    function startPoller(event) {
      logger.debug('Received Director Event: ', event);
      if ((event.type === CONST.API_SERVER.WATCH_EVENT.ADDED || event.type === CONST.API_SERVER.WATCH_EVENT.MODIFIED) && !BOSHTaskPoller.pollers[event.object.metadata.name]) {
        logger.info('starting poller for deployment ', event.object.metadata.name);
        const interval = setInterval(() => poller(event.object, interval), CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL);
        BOSHTaskPoller.pollers[event.object.metadata.name] = true;
      } else if (event.type === CONST.API_SERVER.WATCH_EVENT.DELETED && !BOSHTaskPoller.pollers[event.object.metadata.name]) {
        logger.info('GETTING DELETE EVENT!!!!!!!!!!!!!!!!!!!! ', event.object);
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