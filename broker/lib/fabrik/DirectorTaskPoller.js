'use strict';

const bosh = require('../../../data-access-layer/bosh');
const DirectorManager = require('./DirectorManager');
const logger = require('../../../common/logger');
const catalog = require('../../../common/models/catalog');
const pubsub = require('pubsub-js');
const CONST = require('../../../common/constants');
const config = require('../../../common/config');
const boshCache = bosh.BoshOperationQueue;
const TIME_POLL = 1 * 60 * 1000;
const LockStatusPoller = require('./LockStatusPoller');
const Promise = require('bluebird');

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
            return DirectorManager.load(catalogPlan)
              .then(manager => manager.createOrUpdateDeployment(deploymentName, cached.params, cached.args));
          })
          .catch(err => {
            logger.error(`Error in scheduled deployment operation for ${deploymentName}`, err);
          });
      })
      .catch(err => logger.error('error in processing deployments', err));
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