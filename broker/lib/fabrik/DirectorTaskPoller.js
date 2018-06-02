'use strict';

const bosh = require('../bosh');
const DirectorManager = require('./DirectorManager');
const logger = require('../logger');
const catalog = require('../models/catalog');
const pubsub = require('pubsub-js');
const CONST = require('../constants');
const config = require('../config');
const boshCache = bosh.BoshOperationQueue;
const TIME_POLL = 1 * 60 * 1000;
const LockStatusPoller = require('./LockStatusPoller');

class DirectorTaskPoller extends LockStatusPoller {
  constructor() {
    super({
      time_interval: TIME_POLL
    });
  }

  action() {
    return boshCache.getDeploymentNames().mapSeries(deploymentName => {
        return Promise.try(() => {
            return boshCache.getDeploymentByName(deploymentName);
          })
          .then(cached => {
            let catalogPlan = catalog.getPlan(cached.plan_id);
            return DirectorManager.load(catalogPlan).createOrUpdateDeployment(deploymentName, cached.params, cached.args);
          })
          .catch(e => {
            logger.error(`Error in scheduled deployment operation for ${deploymentName}`, e);
          });
      })
      .catch(e => logger.error('error in processing deployments', e));
  }
}

const pollerInstance = new DirectorTaskPoller();

pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
  logger.debug('-> Received event ->', eventName);
  if (eventInfo.type === 'internal' && config.enable_bosh_rate_limit && config.etcd) {
    pollerInstance.start();
  } else {
    logger.debug('Bosh Rate Limiting is not enabled');
  }
});

module.exports = pollerInstance;