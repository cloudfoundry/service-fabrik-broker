'use strict';

const pubsub = require('pubsub-js');
const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('../../../data-access-layer/eventmesh');
const CONST = require('../../../common/constants');
const logger = require('../../../common/logger');
const lockManager = eventmesh.lockManager;
const errors = require('../../../common/errors');
const NotFound = errors.NotFound;

class UnlockResourcePoller {
  static start() {
    function poller(object, interval) {
      //TODO-PR - instead of a poller, its better to convert this to a watcher.
      const lockDetails = JSON.parse(object.spec.options);
      return eventmesh.apiServerClient.getResource({
          resourceGroup: lockDetails.lockedResourceDetails.resourceGroup,
          resourceType: lockDetails.lockedResourceDetails.resourceType,
          resourceId: lockDetails.lockedResourceDetails.resourceId
        })
        .then((resource) => {
          const resourceState = resource.status.state;
          logger.debug(`[Unlock Poller] Got resource ${lockDetails.lockedResourceDetails.resourceId} state as `, resourceState);
          //TODO-PR - reuse util method is operationCompleted.
          if (_.includes([
              CONST.APISERVER.RESOURCE_STATE.SUCCEEDED,
              CONST.APISERVER.RESOURCE_STATE.FAILED,
              CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED
            ], resourceState)) {
            return lockManager.unlock(object.metadata.name)
              .then(() => clearInterval(interval));
          }
        })
        .catch(NotFound, err => {
          logger.info('Resource not found : ', err);
          return lockManager.unlock(object.metadata.name)
            .then(() => clearInterval(interval));
        });
    }
    /*
    Starts poller whenever a lock resource is created.
    Polling for only backup operations
    */

    function startPoller(event) {
      logger.debug('Received Lock Event: ', event);
      const lockDetails = JSON.parse(event.object.spec.options);
      if (event.type === CONST.API_SERVER.WATCH_EVENT.ADDED && lockDetails.lockedResourceDetails.resourceGroup === CONST.APISERVER.RESOURCE_GROUPS.BACKUP) {
        // startPoller(event.object);
        logger.info('starting unlock resource poller for deployment ', event.object.metadata.name);
        //TODO-PR - its better to convert this to a generic unlocker, which unlocks all types of resources.
        // It can watch on all resources which have completed their operation whose state can be 'Done' and post unlocking it can update it as 'Completed'.
        const interval = setInterval(() => poller(event.object, interval), CONST.UNLOCK_RESOURCE_POLLER_INTERVAL);
      }
    }
    return eventmesh.apiServerClient.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, startPoller)
      .then(stream => {
        logger.info(`Successfully set watcher on lock resources`);
        return Promise
          .delay(CONST.APISERVER.WATCHER_REFRESH_INTERVAL)
          .then(() => {
            logger.info(`Refreshing stream after ${CONST.APISERVER.WATCHER_REFRESH_INTERVAL}`);
            stream.abort();
            return this.start();
          });
      })
      .catch(e => {
        logger.error(`Error occured in registerWatcher:`, e);
        return Promise
          .delay(CONST.APISERVER.WATCHER_ERROR_DELAY)
          .then(() => {
            logger.info(`Refreshing stream after ${CONST.APISERVER.WATCHER_ERROR_DELAY}`);
            return this.start();
          });
      });
  }
}
pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
  logger.debug('-> Received event ->', eventName);
  if (eventInfo.type === 'internal') {
    UnlockResourcePoller.start();
  }
});
module.exports = UnlockResourcePoller;