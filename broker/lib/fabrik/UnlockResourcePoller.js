const Client = require('kubernetes-client').Client;
const config = require('kubernetes-client').config;
const _ = require('lodash');
const pubsub = require('pubsub-js');
const Promise = require('bluebird');
const JSONStream = require('json-stream');
const eventmesh = require('../../../eventmesh');
const CONST = require('../constants');
const logger = require('../logger');
const lockManager = require('./../../../eventmesh').lockManager;

class UnlockResourcePoller {
    static start() {
        function poller(object, interval) {
            const lockDetails = JSON.parse(object.spec.options);
            return eventmesh.server.getResource(lockDetails.lockedResourceDetails.resourceType, lockDetails.lockedResourceDetails.resourceName, lockDetails.lockedResourceDetails.resourceId)
                .then((resource) => {
                    const resourceState = resource.body.status.state;
                    if (resourceState === CONST.RESOURCE_STATE.SUCCEEDED || resourceState === CONST.RESOURCE_STATE.FAILED || resourceState === CONST.RESOURCE_STATE.ERROR) {
                        return lockManager.unlock(object.body.metadata.name)
                            .then(() => clearInterval(interval));
                    }
                })
                .catch(err => {
                    if (err.code === CONST.HTTP_STATUS_CODE.NOT_FOUND) {
                        return lockManager.unlock(object.body.metadata.name)
                            .then(() => clearInterval(interval));
                    }
                    throw err;
                })
        }

        function startPoller(event) {
            // logger.info('starting poller for ', object.metadata.name);
            // const interval = setInterval(() => poller(object, interval), 3000);
            const lockDetails = JSON.parse(event.object.spec.options);
            if (event.type === CONST.API_SERVER.WATCH_EVENT.ADDED && lockDetails.lockedResourceDetails.resourceType === CONST.RESOURCE_TYPES.BACKUP) {
                // startPoller(event.object);
                logger.info('starting poller for ', event.object.metadata.name);
                const interval = setInterval(() => poller(event.object, interval), CONST.UNLOCK_RESOURCE_POLLER_INTERVAL);
            }
        }
        return eventmesh.server.registerWatcher(CONST.RESOURCE_TYPES.LOCK, CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS, startPoller);
    }
}
pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
    logger.debug('-> Recieved event ->', eventName);
    if (eventInfo.type === 'internal') {
        UnlockResourcePoller.start();
    }
});
module.exports = UnlockResourcePoller;