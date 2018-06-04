'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../config');
const logger = require('../logger');
const errors = require('../errors');
const CONST = require('../constants');
const CacheUpdateError = errors.CacheUpdateError;
const CACHE_KEY = 'bosh/deployments/';
const TASK_KEY = 'bosh/tasks/';
const {
  Etcd3
} = require('etcd3');

/**
 * Lazy load the etcd connection for cases where Etcd is not in the landscape/ not imported
 */
function etcdConnector() {
  const etcd = new Etcd3({
    hosts: config.etcd.url,
    credentials: {
      rootCertificate: Buffer.from(config.etcd.ssl.ca, 'utf8'),
      privateKey: Buffer.from(config.etcd.ssl.key, 'utf8'),
      certChain: Buffer.from(config.etcd.ssl.crt, 'utf8')
    }
  });
  return etcd;
}

function getKey(deploymentName) {
  return `${CACHE_KEY}${deploymentName}`;
}

function getTaskKey(name) {
  return `${TASK_KEY}${name}`;
}

class DeploymentOperation {
  constructor(planId, deploymentName, params, args) {
    this.plan_id = planId;
    this.deployment_name = deploymentName;
    this.params = params;
    this.args = args;
  }

  toJson() {
    return JSON.stringify(this);
  }
}

class BoshOperationCache {
  constructor() {

  }

  /**
   * Checks if the BOSH deployment corresponding to the service instance exists in the Etcd store
   * 
   * @param {Service instance ID} serviceInstanceId 
   */
  containsServiceInstance(serviceInstanceId) {
    logger.debug('Checking if service instance operation is in queue', serviceInstanceId);
    this.getDeploymentNames()
      .then(deploymentNames => _.filter(deploymentNames, o => o.endsWith(serviceInstanceId)))
      .then(filtered => filtered.length === 1);
  }

  /**
   * Checks if the BOSH deployment name is present in the Etcd store
   * 
   * @param {Deployment name} deploymentName 
   */
  containsDeployment(deploymentName) {
    logger.debug("Checking if deployment is in queue", deploymentName);
    const wrapper = new Promise((resolve, reject) => {
      const key = getKey(deploymentName);
      etcdConnector().get(key).then(obj => {
        resolve(obj !== null);
      }).catch(err => reject(err));
    });
    return wrapper;
  }

  /**
   * Checks if the BOSH task ID is present in the Etcd store for the service instance
   * 
   * @param {Service instance ID} serviceInstanceId 
   */
  containsBoshTask(serviceInstanceId) {
    logger.info(`Checking the task for service instance ${serviceInstanceId} in cache`);
    const wrapper = new Promise((resolve, reject) => {
      const key = getTaskKey(serviceInstanceId);
      etcdConnector().get(key).then(obj => {
        resolve(obj !== null);
      }).catch(err => reject(err));
    });
    return wrapper;
  }

  /**
   * Fetches a limited number of BOSH deployment names from the Etcd Store
   * 
   * @param {Number of entries to fetch} numEntries 
   */
  getNEntries(numEntries) {
    logger.debug(`Getting the first ${numEntries} entries in cache`);
    const wrapper = new Promise((resolve, reject) => {
      etcdConnector().getAll().prefix(CACHE_KEY).sort(CONST.ETCD.SORT_BY_CREATE, CONST.ETCD.TARGET_NONE).limit(numEntries).keys().then(out => {
        if (Array.isArray(out)) {
          out = out.map(v => v.substring(CACHE_KEY.length));
        } else {
          throw new Error("Unexpected output");
        }
        resolve(out);
      }).catch(err => reject(err));
    });
    return wrapper;
  }

  /**
   * Fetches all BOSH deployment names in the Etcd store currently
   */
  getDeploymentNames() {
    logger.debug('Getting the current deployment cache...');
    const wrapper = new Promise((resolve, reject) => {
      etcdConnector().getAll().prefix(CACHE_KEY).sort(CONST.ETCD.SORT_BY_CREATE, CONST.ETCD.TARGET_NONE).keys().then(out => {
        if (Array.isArray(out)) {
          out = out.map(v => v.substring(CACHE_KEY.length));
        } else {
          throw new Error("Unexpected output");
        }
        resolve(out);
      }).catch(err => reject(err));
    });
    return wrapper;
  }

  /**
   * Fetches BOSH task ID for a service instance from the Etcd store
   * 
   * @param {Service instance ID} serviceInstanceId 
   */
  getBoshTask(serviceInstanceId) {
    logger.debug(`Getting bosh task ID for service instance id ${serviceInstanceId}`);
    const wrapper = new Promise((resolve, reject) => {
      const key = getTaskKey(serviceInstanceId);
      etcdConnector().get(key).string().then(obj => {
        resolve(obj);
      }).catch(err => reject(err));
    });
    return wrapper;
  }

  /**
   * Fetches parameters for a BOSH deployment operation from the Etcd store based on the name
   * 
   * @param {Deployment Name} name 
   */
  getDeploymentByName(name) {
    logger.debug('Getting deployment for ', name);
    const wrapper = new Promise((resolve, reject) => {
      etcdConnector().get(getKey(name)).json().then(out => resolve(out)).catch(err => reject(err));
    });
    return wrapper;
  }

  /**
   * Deletes a single BOSH deployment from the Etcd Store
   * 
   * @param {Deployment Name} deploymentName 
   */
  deleteDeploymentFromCache(deploymentName) {
    logger.info('Removing deployment from cache', deploymentName);
    const wrapper = new Promise((resolve, reject) => {
      etcdConnector().delete().key(getKey(deploymentName)).then(out => resolve(out)).catch(err => reject(err));
    });
    return wrapper;
  }

  /**
   * Deletes multiple BOSH deployment names from the Etcd store
   * 
   * @param {Deployment Names} deployments 
   */
  deleteDeploymentsFromCache(...deployments) {
    const deploymentIdentifiers = _.flattenDeep(deployments);
    logger.info('Removing multiple deployments from cache', deployments);
    const deletePromises = _.map(deploymentIdentifiers, this.deleteDeploymentFromCache);
    return Promise.all(deletePromises);
  }

  /**
   * Stores the BOSH task ID corresponding to the service instance ID when the task is submitted to the BOSH Director
   * 
   * @param {Service Instance ID} serviceInstanceId 
   * @param {BOSH Task ID corresponding to the operation} taskId 
   */
  storeBoshTask(serviceInstanceId, taskId) {
    logger.info("Putting the current deployment task into the cache", serviceInstanceId, taskId);
    const wrapper = new Promise((resolve, reject) => {
      const key = getTaskKey(serviceInstanceId);
      etcdConnector().put(key).value(taskId)
        .then(() => resolve(true))
        .catch(err => {
          logger.error('Error in storing BOSH task id for instance', err);
          reject(err);
        });
    });
    return wrapper;
  }

  /**
   * Stores the deployment operation (user-triggered) into the Etcd store as a JSON document
   * Key is prefixed with a specific format and the deployment name is used as the identifier
   * 
   * @param {Service plan ID for the service instance} planId 
   * @param {Calculated bosh deployment name} deploymentName 
   * @param {Parameters used for the operation} params 
   * @param {Arguments used for the operation} args 
   */
  store(planId, deploymentName, params, args) {
    logger.info("Putting the current deployment operation into the cache", planId, deploymentName, params, args);
    const wrapper = new Promise((resolve, reject) => {
      const key = getKey(deploymentName);
      const operation = new DeploymentOperation(planId, deploymentName, params, args);
      this.containsDeployment(deploymentName).then(exists => {
        if (exists) {
          return resolve(false);
        } else {
          etcdConnector().put(key)
            .value(operation.toJson()).then(() => resolve(true))
            .catch(err => {
              logger.error('Error storing key in Etcd', err);
              reject(new CacheUpdateError(key));
            });
        }
      });
    });
    return wrapper;
  }
}

module.exports = new BoshOperationCache();