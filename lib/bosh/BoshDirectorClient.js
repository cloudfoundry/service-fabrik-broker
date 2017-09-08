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
    super({
      headers: {
        Accept: 'application/json,text/plain;q=0.9'
      },
      followRedirect: false
    });
    // primaryConfigs - directors supporting lifecycle oprations
    this.primaryConfigs = BoshDirectorClient.getPrimaryConfigs();
    // activePrimary - directors supporting 'create' oprations
    this.activePrimary = BoshDirectorClient.getActivePrimary();
    // oobDirectorConfigs - directors for OutOfBand backup scenario
    this.oobDirectorConfigs = BoshDirectorClient.getOobDirectorConfigs();
    this.cacheLoadInProgress = false;
    this.populateCache();
  }

  clearCache(config) {
    if (config) {
      logger.info('clearing cache for config - ', config.name);
      _.each(this.cache, (value, key) => value === config ? delete this.cache[key] : '');
    } else {
      this.cache = {};
    }
  }

  static getInfrastructure() {
    return BoshDirectorClient.getActivePrimary()[0].infrastructure;
  }

  static getPrimaryConfigs() {
    return _.filter(config.directors, function (director) {
      return director.primary;
    });
  }

  static getActivePrimary() {
    return _.filter(config.directors, function (director) {
      return director.primary && director.support_create;
    });
  }

  static getOobDirectorConfigs() {
    return _.filter(config.directors, function (director) {
      return !director.primary;
    });
  }

  getConfigByName(name) {
    return _.head(_.filter(config.directors, (director) => director.name === name));
  }

  populateCache() {
    logger.info('Loading Bosh DeploymentName cache... current cached deployments:', _.keys(this.cache));
    this.cacheLoadInProgress = true;
    this.clearCache();
    return Promise
      .map(config.directors,
        (directorConfig) => this.getDeploymentsByConfig(directorConfig))
      .finally(() => {
        this.cacheLoadInProgress = false;
        logger.info('Clearing cacheLoadInProgress flag. Bosh DeploymentName cache is loaded.');
        logger.silly('Cached Deployments:', _.keys(this.cache));
      });
  }

  getDeploymentNamesFromCache(boshName, attempt) {
    return Promise.try(() => {
      if (this.cacheLoadInProgress) {
        if (!attempt) {
          attempt = 1;
        } else if (attempt > CONST.BOSH_POLL_MAX_ATTEMPTS) {
          throw errors.Timeout.toManyAttempts(CONST.BOSH_POLL_MAX_ATTEMPTS, new Error('Fetching deployments from Cache is taking too long.'));
        }
        logger.info(`Cache load in progress. GetDeploymentNames will be delayed by 500 ms - current attempt ${attempt}`);
        return Promise.delay(500 * attempt).then(() => this.getDeploymentNamesFromCache(boshName, ++attempt));
      }
      if (boshName) {
        const deploymentNames = [];
        const config = this.getConfigByName(boshName);
        _.each(this.cache, (value, key) => value === config ? deploymentNames.push(key) : '');
        return deploymentNames;
      } else {
        return _.keys(this.cache);
      }
    });
  }

  updateCache(config, deployments) {
    return Promise.try(() => {
      this.clearCache(config);
      _.map(deployments, deployment => {
        if (this.cache[deployment.name] === undefined) {
          this.cache[deployment.name] = config;
        } else {
          this.cache[deployment.name] = CONST.ERR_CODES.DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS;
        }
      });
    });
  }

  deleteCacheEntry(deploymentName) {
    return delete this.cache[deploymentName];
  }

  getDirectorConfig(deploymentName) {
    return Promise.try(() => {
      logger.debug(`Finding the correct director config for:`, deploymentName);
      const cache_val = this.cache[deploymentName];
      if (cache_val !== undefined) {
        logger.silly('found director in cache...', cache_val.name);
        return cache_val;
      }
      logger.debug('cache miss for..', deploymentName);
      if (this.cacheLoadInProgress) {
        logger.debug('Cache load in progress.. deferring execution..', this.cacheLoadInProgress);
        return Promise.delay(500).then(() => this.getDirectorConfig(deploymentName));
      }
      return this
        .populateCache()
        .then(() => {
          const cache_val = this.cache[deploymentName];
          if (cache_val !== undefined) {
            if (cache_val === CONST.ERR_CODES.DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS) {
              throw new errors.Conflict(`${deploymentName} is found in more than one of the configured directors. Cant process the request!`);
            }
            return cache_val;
          } else {
            throw new errors.NotFound(`Deployment not found in directors`, deploymentName);
          }
        });
    });
  }

  makeRequest(requestDetails, expectedStatusCode, deploymentName) {
    return this.getDirectorConfig(deploymentName)
      .then(directorConfig => this.makeRequestWithConfig(requestDetails, expectedStatusCode, directorConfig));
  }

  makeRequestWithConfig(requestDetails, expectedStatusCode, directorConfig) {
    requestDetails.baseUrl = directorConfig.url;
    requestDetails.auth = {
      user: directorConfig.username,
      pass: directorConfig.password
    };
    requestDetails.rejectUnauthorized = !directorConfig.skip_ssl_validation;
    return this.request(requestDetails, expectedStatusCode);
  }

  getInfo() {
    return this
      .makeRequestWithConfig({
        method: 'GET',
        url: '/info'
      }, 200, _.sample(this.activePrimary))
      .then(res => JSON.parse(res.body));
  }

  /* Deployment operations */

  getDeploymentsByConfig(config) {
    return this
      .makeRequestWithConfig({
        method: 'GET',
        url: '/deployments'
      }, 200, config)
      .then(res => JSON.parse(res.body))
      .tap(deployments => {
        this.updateCache(config, deployments);
        logger.info('Updated cache for config - ', config.name);
      });
  }

  getDeployments() {
    return Promise
      .map(this.primaryConfigs, directorConfig => {
        return this
          .getDeploymentsByConfig(directorConfig);
      })
      .reduce((all_deployments, deployments) => all_deployments.concat(deployments), []);
  }

  getDeploymentNameForInstanceId(guid) {
    logger.debug(`Finding deployment name for instance id : '${guid}'`);
    return Promise.try(() => {
      const match = _
        .chain(this.cache)
        .keys()
        .filter((name) => _.endsWith(name, guid))
        .value();
      if (match.length > 0) {
        return match[0];
      }
      logger.info(`Cache miss for deployment for instance guid ${guid}. Will load all deployment names..`);
      return this.getDeploymentNames(false)
        .then(deploymentNames => {
          const deploymentName = _.find(deploymentNames, name => _.endsWith(name, guid));
          if (!deploymentName) {
            logger.warn('+-> Could not find a matching deployment');
            throw new errors.ServiceInstanceNotFound(guid);
          }
          return deploymentName;
        });
    });
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
          logger.info(`Lock duration is : ${lockDuration} (secs) -- ${this.activePrimary[0].lock_deployment_max_duration}`);
          if (lockDuration < this.activePrimary[0].lock_deployment_max_duration) {
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
    const config = _.sample(this.activePrimary);
    if (config === undefined || config.length === 0) {
      throw new errors.NotFound('Did not find any bosh director config which supports creation of deployment');
    }
    return this
      .makeRequestWithConfig({
        method: 'POST',
        url: '/deployments',
        headers: {
          'Content-Type': 'text/yaml'
        },
        qs: query,
        body: _.isObject(manifest) ? yaml.safeDump(manifest) : manifest
      }, 302, config)
      .tap(() => {
        logger.info(`Cached ${deploymentName} at director: ${config.name} ${config.url}`);
        this.cache[deploymentName] = config;
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

  pollTaskStatusTillComplete(taskId, pollInterval, timeout, maxErrorRetry) {
    let errorRetries = 0;
    maxErrorRetry = maxErrorRetry || CONST.BOSH_POLL_MAX_ATTEMPTS;
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
            errorRetries++;
            logger.error(`+-> error occurred while fetching state of task id: ${taskId} - attempt #${errorRetries} `, err);
            if (errorRetries > maxErrorRetry) {
              clearInterval(timer);
              return reject(err);
            }
          });
      };
      const timer = setInterval(statePoller,
        pollInterval || this.activePrimary[0].default_task_poll_interval);
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
      .map(this.primaryConfigs, directorConfig => this
        .makeRequestWithConfig({
          method: 'GET',
          url: '/tasks',
          qs: _.pick(query, ['limit', 'state', 'deployment'])
        }, 200, directorConfig)
        .then(res => JSON.parse(res.body))
        .map(task => {
          task.id = `${options.deployment}_${task.id}`;
          return task;
        })
      )
      .reduce((all_tasks, tasks) => all_tasks.concat(tasks), []);
  }

  getTask(taskId) {
    const splitArray = this.parseTaskid(taskId);
    if (splitArray === null) {
      return this
        .makeRequestWithConfig({
          method: 'GET',
          url: `/tasks/${taskId}`
        }, 200, this.getConfigByName(CONST.BOSH_DIRECTORS.BOSH))
        .then(res => JSON.parse(res.body));
    }
    const deploymentName = splitArray[1];
    const taskIdAlone = splitArray[2];
    return this
      .makeRequest({
        method: 'GET',
        url: `/tasks/${taskIdAlone}`
      }, 200, deploymentName)
      .then(res => JSON.parse(res.body));
  }

  getTaskResult(taskId) {
    const splitArray = this.parseTaskid(taskId);
    if (splitArray === null) {
      return this
        .makeRequestWithConfig({
          method: 'GET',
          url: `/tasks/${taskId}/output`,
          qs: {
            type: 'result'
          }
        }, 200, this.getConfigByName(CONST.BOSH_DIRECTORS.BOSH))
        .then(res => _
          .chain(res.body)
          .split('\n')
          .compact()
          .map(JSON.parse)
          .value()
        );
    }
    const deploymentName = splitArray[1];
    const taskIdAlone = splitArray[2];
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
    const splitArray = this.parseTaskid(taskId);
    if (splitArray === null) {
      return this
        .makeRequestWithConfig({
          method: 'GET',
          url: `/tasks/${taskId}/output`,
          qs: {
            type: 'event'
          }
        }, 200, this.getConfigByName(CONST.BOSH_DIRECTORS.BOSH))
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
    const deploymentName = splitArray[1];
    const taskIdAlone = splitArray[2];
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

  parseTaskid(prefixedTaskid) {
    // slice 1 - deploymentName
    // slice 2 - taskId
    return utils.taskIdRegExp().exec(prefixedTaskid);
  }

  prefixTaskId(deploymentName, res) {
    return `${deploymentName}_${this.lastSegment(res.headers.location)}`;
  }

  lastSegment(url) {
    return _.last(parseUrl(url).path.split('/'));
  }
}

module.exports = BoshDirectorClient;