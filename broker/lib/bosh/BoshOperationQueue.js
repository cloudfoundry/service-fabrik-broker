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

function getDeploymentKey(deploymentName) {
  return `${CACHE_KEY}${deploymentName}`;
}

function getTaskKey(name) {
  return `${TASK_KEY}${name}`;
}

function containsKey(keyName) {
  logger.debug(`Checking if key ${keyName} exists in etcd store`);
  return Promise.try(() => {
    return etcdConnector().get(keyName)
      .then(obj => {
        return obj !== null;
      });
  });
}

function getKeyValue(keyName, outputType) {
  return Promise.try(() => {
    let query = etcdConnector().get(keyName);
    if (outputType === CONST.ETCD.JSON) {
      query = query.json();
    } else if (outputType === CONST.ETCD.NUMBER) {
      query = query.number();
    } else {
      query = query.string();
    }
    return query;
  });
}

function deleteKey(keyName) {
  return Promise.try(() => {
    return etcdConnector().delete().key(keyName);
  });
}

function putKeyValue(key, value) {
  return etcdConnector().put(key).value(value)
    .catch(err => {
      logger.error(`Error in storing key-value pair ${key} ${value}`, err);
      throw new CacheUpdateError(err);
    });
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

class BoshOperationQueue {
  constructor() {}

  /**
   * Checks if the BOSH deployment corresponding to the service instance exists in the Etcd store
   * 
   * @param {string} serviceInstanceId - Service Instance ID
   */
  containsServiceInstance(serviceInstanceId) {
    logger.debug('Checking if service instance operation is in queue', serviceInstanceId);
    return this.getDeploymentNames()
      .then(deploymentNames => _.filter(deploymentNames, o => o.endsWith(serviceInstanceId)))
      .then(filtered => filtered.length === 1);
  }

  /**
   * Checks if the BOSH deployment name is present in the Etcd store
   * 
   * @param {string} deploymentName - Deployment Name
   */
  containsDeployment(deploymentName) {
    logger.debug(`Checking if deployment is in queue:: ${deploymentName}`);
    const deploymentKey = getDeploymentKey(deploymentName);
    return containsKey(deploymentKey);
  }

  /**
   * Checks if the BOSH task ID is present in the Etcd store for the service instance
   * 
   * @param {string} serviceInstanceId - Service instance ID
   */
  containsBoshTask(serviceInstanceId) {
    logger.debug(`Checking the task for service instance ${serviceInstanceId} in cache`);
    const taskKey = getTaskKey(serviceInstanceId);
    return containsKey(taskKey);
  }

  /**
   * Fetches a limited number of BOSH deployment names from the Etcd Store
   * 
   * @param {string} numEntries - Number of entries to fetch
   */
  getNEntries(numEntries) {
    logger.debug(`Getting the first ${numEntries} entries in cache`);
    return this.getDeploymentNames(numEntries);
  }

  /**
   * Fetches all BOSH deployment names in the Etcd store currently
   */
  getDeploymentNames(numRecords) {
    logger.debug('Getting the current deployment cache...');
    return Promise.try(() => {
      let serviceQuery = etcdConnector().getAll().prefix(CACHE_KEY).sort(CONST.ETCD.SORT_BY_CREATE, CONST.ETCD.TARGET_NONE);
      if (numRecords) {
        serviceQuery = serviceQuery.limit(numRecords);
      }
      return serviceQuery.keys()
        .then(out => {
          if (Array.isArray(out)) {
            out = out.map(v => v.substring(CACHE_KEY.length));
          } else {
            throw new Error('Unexpected output');
          }
          return out;
        });
    });
  }

  /**
   * Fetches BOSH task ID for a service instance from the Etcd store
   * 
   * @param {string} serviceInstanceId - Service instance ID
   */
  getBoshTask(serviceInstanceId) {
    logger.debug(`Getting bosh task ID for service instance id ${serviceInstanceId}`);
    return getKeyValue(getTaskKey(serviceInstanceId), CONST.ETCD.STRING);
  }

  /**
   * Fetches parameters for a BOSH deployment operation from the Etcd store based on the name
   * 
   * @param {string} name - Deployment Name
   */
  getDeploymentByName(name) {
    logger.debug('Getting deployment for ', name);
    const namespaceKey = getDeploymentKey(name);
    return getKeyValue(namespaceKey, CONST.ETCD.JSON)
      .then(val => {
        logger.debug(`found value for key ${namespaceKey}: ${val}`);
        return val;
      });
  }

  deleteBoshTask(serviceInstanceId) {
    logger.info('Removing task from cache for service instance', serviceInstanceId);
    return deleteKey(getTaskKey(serviceInstanceId));
  }

  /**
   * Deletes a single BOSH deployment from the Etcd Store
   * 
   * @param {string} deploymentName - Deployment Name
   */
  deleteDeploymentFromCache(deploymentName) {
    logger.info('Removing deployment from cache', deploymentName);
    return deleteKey(getDeploymentKey(deploymentName));
  }

  /**
   * Deletes multiple BOSH deployment names from the Etcd store
   * 
   * @param {(string|string[])} deployments - List of Deployment Names
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
   * @param {string} serviceInstanceId  - Service Instance ID
   * @param {string} taskId - BOSH Task ID corresponding to the operation
   */
  saveBoshTask(serviceInstanceId, taskId) {
    logger.info('Putting the current deployment task into the cache', serviceInstanceId, taskId);
    return Promise.try(() => {
      const key = getTaskKey(serviceInstanceId);
      return putKeyValue(key, taskId);
    });
  }

  /**
   * Stores the deployment operation (user-triggered) into the Etcd store as a JSON document
   * Key is prefixed with a specific format and the deployment name is used as the identifier
   * 
   * @param {string} planId - Service plan ID for the service instance
   * @param {string} deploymentName - Calculated bosh deployment name
   * @param {Object} params - Parameters used for the operation
   * @param {Object} args - Arguments used for the operation
   */
  saveDeployment(planId, deploymentName, params, args) {
    logger.info('Putting the current deployment operation into the cache', planId, deploymentName, params, args);
    return Promise.try(() => {
      const key = getDeploymentKey(deploymentName);
      const operation = new DeploymentOperation(planId, deploymentName, params, args);
      return this.containsDeployment(deploymentName).then(exists => {
        if (exists) {
          return false;
        } else {
          return putKeyValue(key, operation.toJson());
        }
      });
    });
  }
}

module.exports = new BoshOperationQueue();