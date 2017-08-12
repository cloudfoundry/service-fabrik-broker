'use strict';

const parseUrl = require('url').parse;
const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const errors = require('../errors');
const Timeout = errors.Timeout;
const logger = require('../logger');
const utils = require('../utils');
const CONST = require('../constants');
const retry = utils.retry;
const HttpClient = utils.HttpClient;
const config = require('../config');
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;

class BoshDirectorClient extends HttpClient {
  constructor() {
    // activeConfigs - directors supporting lifecycle oprations
    let activeConfigs = BoshDirectorClient.getActiveConfigs();
    // directorConfig - directors supporting 'create' oprations
    let coreConfigs = BoshDirectorClient.getCoreConfigs(activeConfigs);
    // inactiveConfigs - directors for OutOfBand backup scenario
    let inactiveConfigs = BoshDirectorClient.getInactiveConfigs();
    let config = BoshDirectorClient.getPrimaryConfig(coreConfigs);
    super({
      headers: {
        Accept: 'application/json,text/plain;q=0.9'
      },
      followRedirect: false,
      rejectUnauthorized: !config.skip_ssl_validation
    });
    this.activeConfigs = activeConfigs;
    this.coreConfigs = coreConfigs;
    this.inactiveConfigs = inactiveConfigs;
    this.config = config;
    logger.info('Active Configs', this.activeConfigs);
    logger.info('Core Configs', this.coreConfigs);
    logger.info('Inactive Configs', this.inactiveConfigs);
    logger.info('Create Config', this.config);
    this.primary = this.config.primary || false;
    this.uuid = this.config.uuid;
    this.cpi = this.config.cpi;
    this.infrastructure = this.config.infrastructure;
    this.populateCache();
  }

  clearCache() {
    this.cache = {};
  }

  static getActiveConfigs() {
    return _.filter(config.directors, function (director) {
      return director.primary;
    });
  }

  static getCoreConfigs(activeConfigs) {
    return _.filter(activeConfigs, function (director) {
      return director.supportCreate;
    });
  }

  static getInactiveConfigs() {
    return _.filter(config.directors, function (director) {
      return !director.primary;
    });
  }

  static getPrimaryConfig(coreConfigs) {
    return _.sample(coreConfigs);
  }

  getConfigByName(name) {
    return _.head(_.filter(config.directors, (director) => director.name === name));
  }

  populateCache() {
    this.clearCache();
    return this
      .getDeployments()
      .tap(() => logger.debug('Cached Deployments:', this.cache));
  }

  addInactiveToCache() {
    return this
      .getDeployments(true)
      .tap(() => logger.debug('Cached Deployments:', this.cache));
  }

  deleteCacheEntry(deploymentName) {
    return delete this.cache[deploymentName];
  }

  getDirectorConfig(deploymentName) {
    return Promise.try(() => {
      logger.info(`Finding the correct director config for:`, deploymentName);
      if (deploymentName === undefined) {
        return this.config;
      }
      const cache_val = this.cache[deploymentName];
      if (cache_val !== undefined) {
        logger.debug('found director in cache...', cache_val);
        return cache_val;
      }
      logger.debug('cache miss for', deploymentName);
      return this
        .addInactiveToCache()
        .then(() => {
          const cache_val = this.cache[deploymentName];
          if (cache_val !== undefined) {
            return cache_val;
          } else {
            throw new errors.NotFound(`Deployment not found in directors`, deploymentName);
          }
        });
    });
  }

  makeRequest(requestDetails, expectedStatusCode, deploymentName) {
    return this.getDirectorConfig(deploymentName)
      .then(directorConfig => {
        requestDetails.baseUrl = directorConfig.url;
        requestDetails.auth = {
          user: directorConfig.username,
          pass: directorConfig.password
        };
        requestDetails.rejectUnauthorized = !directorConfig.skip_ssl_validation;
        return this.request(requestDetails, expectedStatusCode);
      });
  }

  makeRequestWithConfig(requestDetails, expectedStatusCode, directorConfig) {
    requestDetails.baseUrl = `${directorConfig.url}`;
    requestDetails.auth = {
      user: directorConfig.username,
      pass: directorConfig.password
    };
    return this.request(requestDetails, expectedStatusCode);
  }

  getInfo() {
    return this
      .makeRequest({
        method: 'GET',
        url: '/info'
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  /* Deployment operations */

  getDeployments(queryInactive) {
    let configs = queryInactive === undefined ? this.activeConfigs : this.inactiveConfigs;
    return Promise
      .map(configs, directorConfig => {
        return this
          .makeRequestWithConfig({
            method: 'GET',
            url: '/deployments'
          }, 200, directorConfig)
          .then(res => JSON.parse(res.body))
          .tap(deployments => _
            .map(deployments, deployment => this
              .cache[deployment.name] = directorConfig));
      })
      .reduce((all_deployments, deployments) => all_deployments.concat(deployments), []);
  }

  getDeploymentNames(queued) {
    const activeDeploymentNames = this
      .getDeployments()
      .then(deployments =>
        _.map(deployments, deployment => deployment.name));
    const queuedDeploymentNames = !queued ? [] : this
      .getTasks({
        state: 'queued'
      })
      .then(tasks => _.map(tasks, task => task.deployment));
    return Promise
      .all([
        activeDeploymentNames,
        queuedDeploymentNames
      ])
      .then(deploymentNames => _
        .chain(deploymentNames)
        .flatten()
        .compact()
        .uniq()
        .value()
      );
  }

  getLockProperty(deploymentName) {
    return this
      .getDeploymentProperty(deploymentName, CONST.DEPLOYMENT_LOCK_NAME)
      .then(result => {
        const lockInfo = JSON.parse(result);
        logger.debug('LockInfo :-', lockInfo);
        if (lockInfo.createdAt) {
          lockInfo.createdAt = new Date(lockInfo.createdAt);
          //Above check unnecessary, but for whatsoever reason if the lock is corrupted, we dont return back lockinfo
          const lockDuration = (new Date() - lockInfo.createdAt) / 1000;
          logger.info(`Lock duration is : ${lockDuration} (secs) -- ${this.config.lock_deployment_max_duration}`);
          if (lockDuration < this.config.lock_deployment_max_duration) {
            return Promise.resolve(lockInfo);
          }
        }
        return undefined;
      })
      .catch(NotFound, () => undefined);
  }

  getDeployment(deploymentName) {
    return this
      .makeRequest({
        method: 'GET',
        url: `/deployments/${deploymentName}`
      }, 200, deploymentName)
      .then(res => JSON.parse(res.body));
  }

  diffDeploymentManifest(deploymentName, manifest) {
    return this
      .makeRequest({
        method: 'POST',
        url: `/deployments/${deploymentName}/diff`,
        headers: {
          'Content-Type': 'text/yaml'
        },
        qs: {
          redact: 'false'
        },
        body: _.isObject(manifest) ? yaml.safeDump(manifest) : manifest
      }, 200, deploymentName)
      .then(res => JSON.parse(res.body));
  }


  getDeploymentManifest(deploymentName) {
    logger.debug(`Fetching deployment manifest ${deploymentName}`);
    return this
      .getDeployment(deploymentName)
      .then(deployment => deployment.manifest ?
        yaml.safeLoad(deployment.manifest) : null
      );
  }

  createOrUpdateDeployment(manifest, opts) {
    const query = opts ? _.pick(opts, 'recreate', 'skip_drain', 'context') : undefined;
    const deploymentName = yaml.safeLoad(manifest).name;
    return this
      .makeRequestWithConfig({
        method: 'POST',
        url: '/deployments',
        headers: {
          'Content-Type': 'text/yaml'
        },
        qs: query,
        body: _.isObject(manifest) ? yaml.safeDump(manifest) : manifest
      }, 302, this.config)
      .tap(() => {
        logger.info(`Cached ${deploymentName} at director: ${this.config.name} ${this.config.url}`);
        this.cache[deploymentName] = this.config;
      })
      .then(res => this.prefixTaskId(deploymentName, res));
  }

  deleteDeployment(deploymentName) {
    return this
      .makeRequest({
        method: 'DELETE',
        url: `/deployments/${deploymentName}`
      }, 302, deploymentName)
      .then(res => this.prefixTaskId(deploymentName, res));
  }

  /* VirtualMachines operations */
  getDeploymentVms(deploymentName) {
    return this
      .makeRequest({
        method: 'GET',
        url: `/deployments/${deploymentName}/vms`
      }, 200, deploymentName)
      .then(res => JSON.parse(res.body));
  }

  /* Property operations */
  getDeploymentProperties(deploymentName) {
    return this
      .makeRequest({
        method: 'GET',
        url: `/deployments/${deploymentName}/properties`
      }, 200, deploymentName)
      .then(res => JSON.parse(res.body));
  }

  getDeploymentIps(deploymentName) {
    return this.getDeploymentManifest(deploymentName)
      .tap(manifest => {
        if (_.isNil(manifest)) {
          throw new BadRequest(`The deployment ${deploymentName} does not exist`);
        }
      })
      .then(manifest => _
        .chain(manifest.jobs)
        .map(job => _.map(job.networks, net => net.static_ips))
        .flattenDeep()
        .value()
      );
  }

  getAgentPropertiesFromManifest(deploymentName) {
    return this.getDeploymentManifest(deploymentName)
      .tap(manifest => {
        if (_.isNil(manifest)) {
          throw new BadRequest(`The deployment ${deploymentName} does not exist`);
        }
      })
      .then(manifest => {
        return manifest.properties.agent;
      });
  }

  getNormalizedDeploymentVms(deploymentName) {
    function normalizeVm(vm) {
      return _.pick(vm, 'cid', 'job', 'index');
    }
    return this.getDeploymentVms(deploymentName)
      .map(normalizeVm);
  }

  getDeploymentVmsVitals(deploymentName) {
    const self = this;

    function createTask(deploymentName) {
      return self
        .makeRequest({
          method: 'GET',
          url: `/deployments/${deploymentName}/instances`,
          qs: {
            format: 'full'
          }
        }, 302)
        .then(res => this.prefixTaskId(deploymentName, res));
    }


    function waitForTaskToBeDone(taskId) {
      return retry(() => self
        .getTask(taskId)
        .tap(task => {
          if (task.state !== 'done') {
            const err = new Error(`Task not yet done: state is '${task.state}'`);
            err.state = task.state;
            throw err;
          }
        }), {
          maxAttempts: 8,
          minDelay: 500,
          predicate: err => _.includes(['processing', 'queued'], err.state)
        });
    }

    function getTaskResult(taskId) {
      return self.getTaskResult(taskId);
    }

    return createTask(deploymentName)
      .tap(taskId => waitForTaskToBeDone(taskId))
      .then(taskId => getTaskResult(taskId));

  }

  pollTaskStatusTillComplete(taskId, pollInterval, timeout) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      logger.debug('will query state for task :', taskId);
      const statePoller = () => {
        this.getTask(taskId)
          .tap(task => logger.info(`+-> Fetched task for deployment '${task.deployment}' has state '${task.state}'`))
          .then(task => {
            const timestamp = new Date(task.timestamp * 1000).toISOString();
            switch (task.state) {
            case 'done':
              logger.info(`Task ${task.deployment} succeeded`);
              clearInterval(timer);
              return resolve(task);
            case 'error':
            case 'cancelled':
            case 'timeout':
              clearInterval(timer);
              const errMsg = `Task ${task.deployment} failed at ${timestamp} with error "${task.result}"`;
              logger.error(errMsg);
              return reject(new Error(errMsg), task);
            default:
              const time = Date.now() - startTime;
              if (time >= (timeout || Infinity)) {
                logger.error(`deployment ${task.deployment} failed! Failed to provision MongoDB!`);
                return reject(Timeout.timedOut(time), task);
              }
              logger.debug(`Task ${task.deployment} - is still - ${task.state}. Task state polling will continue...`);
            }
          })
          .catch(err => {
            logger.error(`error occurred while fetching state of task id: ${taskId}`, err);
            clearInterval(timer);
            return reject(err);
          });
      };
      const timer = setInterval(statePoller,
        pollInterval || this.config.default_task_poll_interval);
    });
  }

  createDeploymentProperty(deploymentName, propertyName, propertyValue) {
    return this
      .makeRequest({
        method: 'POST',
        url: `/deployments/${deploymentName}/properties`,
        json: true,
        body: {
          name: propertyName,
          value: propertyValue
        }
      }, 204, deploymentName);
  }

  updateDeploymentProperty(deploymentName, propertyName, propertyValue) {
    return this
      .makeRequest({
        method: 'PUT',
        url: `/deployments/${deploymentName}/properties/${propertyName}`,
        json: true,
        body: {
          value: propertyValue
        }
      }, 204, deploymentName);
  }

  createOrUpdateDeploymentProperty(deploymentName, propertyName, propertyValue) {
    return this
      .createDeploymentProperty(deploymentName, propertyName, propertyValue)
      .catch(BadRequest, err => {
        /* jshint unused:false */
        return this.updateDeploymentProperty(deploymentName, propertyName, propertyValue);
      });
  }

  updateOrCreateDeploymentProperty(deploymentName, propertyName, propertyValue) {
    return this
      .updateDeploymentProperty(deploymentName, propertyName, propertyValue)
      .catch(NotFound, err => {
        /* jshint unused:false */
        return this.createDeploymentProperty(deploymentName, propertyName, propertyValue);
      });
  }

  getDeploymentProperty(deploymentName, propertyName) {
    return this
      .makeRequest({
        method: 'GET',
        url: `/deployments/${deploymentName}/properties/${propertyName}`
      }, 200, deploymentName)
      .then(res => JSON.parse(res.body).value);
  }

  deleteDeploymentProperty(deploymentName, propertyName) {
    return this
      .makeRequest({
        method: 'DELETE',
        url: `/deployments/${deploymentName}/properties/${propertyName}`
      }, 204, deploymentName);
  }

  /*  Task operations */

  getTasks(options) {
    const query = _.assign({
      limit: 1000
    }, options);

    return Promise
      .map(this.activeConfigs, directorConfig => this
        .makeRequestWithConfig({
          method: 'GET',
          url: '/tasks',
          qs: _.pick(query, ['limit', 'state', 'deployment'])
        }, 200, directorConfig)
        .then(res => JSON.parse(res.body))
      )
      .reduce((all_tasks, tasks) => all_tasks.concat(tasks), []);
  }

  getTask(taskId) {
    var deploymentName = this.parseTaskid(taskId, 1);
    var taskIdAlone = this.parseTaskid(taskId, 2);
    return this
      .makeRequest({
        method: 'GET',
        url: `/tasks/${taskIdAlone}`
      }, 200, deploymentName)
      .then(res => JSON.parse(res.body));
  }

  getTaskResult(taskId) {
    var deploymentName = this.parseTaskid(taskId, 1);
    var taskIdAlone = this.parseTaskid(taskId, 2);
    return this
      .makeRequest({
        method: 'GET',
        url: `/tasks/${taskIdAlone}/output`,
        qs: {
          type: 'result'
        }
      }, 200, deploymentName)
      .then(res => _
        .chain(res.body)
        .split('\n')
        .compact()
        .map(JSON.parse)
        .value()
      );
  }

  getTaskEvents(taskId) {
    var deploymentName = this.parseTaskid(taskId, 1);
    var taskIdAlone = this.parseTaskid(taskId, 2);
    return this
      .makeRequest({
        method: 'GET',
        url: `/tasks/${taskIdAlone}/output`,
        qs: {
          type: 'event'
        }
      }, 200, deploymentName)
      .then(res => {
        let events = [];
        _.trim(res.body).split('\n').forEach((event) => {
          try {
            events.push(JSON.parse(event));
          } catch (err) {
            logger.error(`Error parsing task event "${event}": ${err.message}`, err);
          }
        });
        return events;
      });
  }

  parseTaskid(prefixedTaskid, sliceNo) {
    // slice 1 - deploymentName
    // slice 2 - taskId
    return utils.taskIdRegExp().exec(prefixedTaskid)[sliceNo];
  }

  prefixTaskId(deploymentName, res) {
    return Promise.resolve(`${deploymentName}_${this.lastSegment(res.headers.location)}`);
  }

  lastSegment(url) {
    return _.last(parseUrl(url).path.split('/'));
  }
}

module.exports = BoshDirectorClient;