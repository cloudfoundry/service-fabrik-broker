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
            return eventmesh.server.getResource(lockDetails.lockedResourceDetails.resourceType, lockDetails.lockedResourceDetails.resourceType, lockDetails.lockedResourceDetails.resourceId)
                .then((resource) => {
                    const resourceState = resource.body.status.state;
                    if (resourceState === "succeeded" || resourceState === "error" || resourceState === "failed") {
                        return lockManager.unlock(object.body.metadata.name)
                            .then(() => clearInterval(interval));
                    }
                })
                .catch(err => {
                    if (err.code === 404) {
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
            if (event.type === "ADDED" && lockDetails.lockedResourceDetails.resourceType === 'backup') {
                // startPoller(event.object);
                logger.info('starting poller for ', event.object.metadata.name);
                const interval = setInterval(() => poller(event.object, interval), 3000);
            }
        }

        // return Promise.try(() => {
        //     eventmesh.server.watchOnResource('lock', 'deploymentlocks')
        //         .then((stream) => {
        //             const jsonStream = new JSONStream();
        //             stream.pipe(jsonStream);
        //             jsonStream.on('data', event => {
        //                 logger.info('Event: ', JSON.stringify(event, null, 2));
        //                 // start poller for each object
        //                 // Poll for locks acquired by backup operation
        //                 const lockDetails = JSON.parse(event.object.spec.options);
        //                 if (event.type === "ADDED" && lockDetails.lockedResourceDetails.resourceType === 'backup') {
        //                     startPoller(event.object);
        //                 }
        //             });
        //         })
        // });
        return eventmesh.server.registerWatcher('lock', 'deploymentlocks', startPoller);
    }
}
pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
    logger.debug('-> Recieved event ->', eventName);
    if (eventInfo.type === 'external' || eventInfo.type === 'internal') {
        UnlockResourcePoller.start();
    }
});
UnlockResourcePoller.start();
module.exports = UnlockResourcePoller;