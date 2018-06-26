'use strict';

const pubsub = require('pubsub-js');
const eventmesh = require('../../../eventmesh');
const CONST = require('../constants');
const logger = require('../logger');
const lockManager = require('./../../../eventmesh').lockManager;
const errors = require('../errors');
const NotFound = errors.NotFound;

class UnlockResourcePoller {
  static start() {
    function poller(object, interval) {
      const lockDetails = JSON.parse(object.spec.options);
      return eventmesh.server.getResource(lockDetails.lockedResourceDetails.resourceType, lockDetails.lockedResourceDetails.resourceName, lockDetails.lockedResourceDetails.resourceId)
        .then((resource) => {
          const resourceState = resource.body.status.state;
          logger.debug(`[Unlock Poller] Got resource ${lockDetails.lockedResourceDetails.resourceId} state as `, resourceState);
          if (resourceState === CONST.APISERVER.RESOURCE_STATE.SUCCEEDED || resourceState === CONST.APISERVER.RESOURCE_STATE.FAILED || resourceState === CONST.APISERVER.RESOURCE_STATE.ERROR) {
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
      const lockDetails = JSON.parse(event.object.spec.options);
      if (event.type === CONST.API_SERVER.WATCH_EVENT.ADDED && lockDetails.lockedResourceDetails.resourceType === CONST.APISERVER.RESOURCE_TYPES.BACKUP) {
        // startPoller(event.object);
        logger.info('starting unlock resource poller for deployment ', event.object.metadata.name);
        const interval = setInterval(() => poller(event.object, interval), CONST.UNLOCK_RESOURCE_POLLER_INTERVAL);
      }
    }
    return eventmesh.server.registerWatcher(CONST.APISERVER.RESOURCE_TYPES.LOCK, CONST.APISERVER.RESOURCE_NAMES.DEPLOYMENT_LOCKS, startPoller);
  }
}
pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
  logger.debug('-> Received event ->', eventName);
  if (eventInfo.type === 'internal') {
    UnlockResourcePoller.start();
  }
});
module.exports = UnlockResourcePoller;