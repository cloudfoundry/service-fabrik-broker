'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const eventmesh = require('../data-access-layer/eventmesh');
const CONST = require('../common/constants');
const errors = require('../common/errors');
const logger = require('../common/logger');
const config = require('../common/config');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const Conflict = errors.Conflict;

class BaseStatusPoller {
  constructor(opts) {
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to start status poller`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to start status poller`);
    assert.ok(opts.validStateList, `Property 'validStateList' is required to start status poller`);
    assert.ok(opts.validEventList, `Property 'validEventList' is required to start status poller`);
    assert.ok(opts.pollInterval, `Property 'pollInterval' is required to start status poller`);
    this.pollers = {};
    this.resourceGroup = opts.resourceGroup;
    this.resourceType = opts.resourceType;
    this.validStateList = opts.validStateList;
    this.validEventList = opts.validEventList;
    this.pollInterval = opts.pollInterval;
    this.init();
  }

  getStatus() {
    throw new NotImplementedBySubclass('getStatus');
  }

  acquireLock(resourceBody) {
    const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(resourceBody.metadata.selfLink);
    const options = _.get(resourceBody, 'spec.options');
    const pollerAnnotation = _.get(resourceBody, 'metadata.annotations.lockedByTaskPoller');
    logger.debug(`pollerAnnotation is ${pollerAnnotation} current time is: ${new Date()}`);
    return Promise.try(() => {
      // If task is not picked by poller which has the lock on task for CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL + POLLER_RELAXATION_TIME then try to acquire lock
      if (pollerAnnotation && (JSON.parse(pollerAnnotation).ip !== config.broker_ip) && (new Date() - new Date(JSON.parse(pollerAnnotation).lockTime) < (this.pollInterval + CONST.POLLER_RELAXATION_TIME))) { // cahnge this to 5000
        logger.debug(`Process with ip ${JSON.parse(pollerAnnotation).ip} is already polling for status`);
        return false;
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
          .tap((updatedResource) => logger.debug(`Successfully acquired status poller lock for resource ${this.resourceType} with options: ${JSON.stringify(options)}\n` +
            `Updated resource with poller annotations is: `, updatedResource))
          .return(true)
          .catch(Conflict, () => {
            logger.debug(`Not able to acquire status poller processing lock for resource ${resourceBody.metadata.name}, Request is probably picked by other worker`);
            return false;
          });
      }
    });
  }

  pollStatus(object, intervalId) {
    const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(object.metadata.selfLink);
    // If no lockedByPoller annotation then set annotation  with time
    // Else check timestamp if more than specific time than start polling and change lockedByPoller Ip
    return eventmesh.apiServerClient.getResource({
        resourceGroup: resourceDetails.resourceGroup,
        resourceType: resourceDetails.resourceType,
        resourceId: object.metadata.name,
      })
      .then(resourceBody => {
        return this.acquireLock(resourceBody)
          .then(isLockAcquired => {
            if (isLockAcquired) {
              if (!_.includes(this.validStateList, _.get(resourceBody, 'status.state'))) {
                this.clearPoller(object.metadata.name, intervalId);
              } else {
                return this.getStatus(resourceBody, intervalId);
              }
            }
          });
      })
      .catch(err => {
        logger.error(`Error occured while polling status for resource: ${this.resourceType}, id: ${object.metadata.name}, clearing poller interval now`, err);
        this.clearPoller(object.metadata.name, intervalId);
      });

  }

  startPoller(event) {
    logger.debug(`Received ${this.resourceType} Event:`, event);
    const resourceId = event.object.metadata.name;
    if (_.includes(this.validEventList, event.type) && !this.pollers[resourceId]) {
      logger.debug(`Starting status poller for resource type ${this.resourceType}, id:`, resourceId);
      // Poller time should be little less than watch refresh interval
      const intervalId = setInterval(() => this.pollStatus(event.object, intervalId), this.pollInterval);
      this.pollers[resourceId] = intervalId;
    }
  }

  init() {
    const queryString = `state in (${_.join(this.validStateList, ',')})`;
    return eventmesh.apiServerClient.registerWatcher(this.resourceGroup, this.resourceType, this.startPoller.bind(this), queryString)
      .then(stream => {
        logger.debug(`Successfully set watcher on ${this.resourceType} resource types for status polling with query string:`, queryString);
        return Promise
          .delay(CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL)
          .then(() => {
            logger.debug(`Refreshing stream after ${CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL}`);
            stream.abort();
            return this.init();
          });
      })
      .catch(err => {
        logger.error(`Error occured in registering watch on ${this.resourceType} resource types for status polling:`, err);
        return Promise
          .delay(CONST.APISERVER.WATCHER_ERROR_DELAY)
          .then(() => {
            logger.debug(`Refreshing stream after ${CONST.APISERVER.WATCHER_ERROR_DELAY}`);
            return this.init();
          });
      });
  }

  clearPoller(resourceId, intervalId) {
    logger.debug(`Clearing status poller interval for resource`, resourceId);
    if (intervalId) {
      clearInterval(intervalId);
    }
    _.unset(this.pollers, resourceId);
  }
}

module.exports = BaseStatusPoller;