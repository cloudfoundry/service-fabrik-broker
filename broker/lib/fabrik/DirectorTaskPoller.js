'use strict';

const bosh = require('../bosh');
const DirectorManager = require('./DirectorManager');
const logger = require('../logger');
const catalog = require('../models/catalog');
const pubsub = require('pubsub-js');
const CONST = require('../constants');
const config = require('../config');
const boshCache = bosh.BoshOperationCache;
const TIME_POLL = 1 * 60 * 1000;

class DirectorTaskPoller {
  constructor() {

  }

  static start() {
    logger.debug(`Starting the BOSH director task poller- runs every ${TIME_POLL} milliseconds`);
    this.deploymentPoller = setInterval(() => {
      boshCache.getDeploymentNames().mapSeries(deploymentName => {
        return Promise.try(() => {
            return boshCache.getDeploymentByName(deploymentName);
          }).then(cached => {
            let catalogPlan = catalog.getPlan(cached.plan_id);
            return DirectorManager.load(catalogPlan).createOrUpdateDeployment(deploymentName, cached.params, cached.args);
          })
          .catch(e => {
            logger.error(`Error in automated deployment for ${deploymentName}`, e);
          });
      }).catch(e => logger.error("error in processing deployments", e));
    }, TIME_POLL);
  }

  static stop() {
    if (this.deploymentPoller) {
      clearInterval(this.deploymentPoller);
    }
  }
}

DirectorTaskPoller.deploymentPoller = undefined;

pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
  logger.debug('-> Received event ->', eventName);
  if (eventInfo.type === 'external' && config.enable_bosh_rate_limit) {
    DirectorTaskPoller.start();
  }
});

module.exports = DirectorTaskPoller;