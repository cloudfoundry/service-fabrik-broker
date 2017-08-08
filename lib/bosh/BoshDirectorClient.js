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
  constructor(boshDirectorConfig) {
    const boshDirector = boshDirectorConfig || config.director;
    super({
      baseUrl: boshDirector.url,
      auth: {
        user: boshDirector.username,
        pass: boshDirector.password
      },
      headers: {
        Accept: 'application/json,text/plain;q=0.9'
      },
      followRedirect: false,
      rejectUnauthorized: !boshDirector.skip_ssl_validation
    });
    this.uuid = boshDirector.uuid;
    this.cpi = boshDirector.cpi;
  }

  getInfo() {
    return this
      .request({
        method: 'GET',
        url: '/info'
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  /* Deployment operations */

  getDeployments() {
    return this
      .request({
        method: 'GET',
        url: '/deployments'
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  getDeploymentNames(queued) {
    const activeDeploymentNames = this
      .getDeployments()
      .then(deployments => _.map(deployments, deployment => deployment.name));
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
          logger.info(`Lock duration is : ${lockDuration} (secs) -- ${config.director.lock_deployment_max_duration}`);
          if (lockDuration < config.director.lock_deployment_max_duration) {
            return Promise.resolve(lockInfo);
          }
        }
        return undefined;
      })
      .catch(NotFound, () => undefined);
  }

  getDeployment(deploymentName) {
    return this
      .request({
        method: 'GET',
        url: `/deployments/${deploymentName}`
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  diffDeploymentManifest(deploymentName, manifest) {
    return this
      .request({
        method: 'POST',
        url: `/deployments/${deploymentName}/diff`,
        headers: {
          'Content-Type': 'text/yaml'
        },
        qs: {
          redact: 'false'
        },
        body: _.isObject(manifest) ? yaml.safeDump(manifest) : manifest
      }, 200)
      .then(res => JSON.parse(res.body));
  }


  getDeploymentManifest(deploymentName) {
    return this
      .getDeployment(deploymentName)
      .then(deployment => deployment.manifest ?
        yaml.safeLoad(deployment.manifest) : null
      );
  }

  createOrUpdateDeployment(manifest, opts) {
    const query = opts ? _.pick(opts, 'recreate', 'skip_drain', 'context') : undefined;
    return this
      .request({
        method: 'POST',
        url: '/deployments',
        headers: {
          'Content-Type': 'text/yaml'
        },
        qs: query,
        body: _.isObject(manifest) ? yaml.safeDump(manifest) : manifest
      }, 302)
      .then(res => parseInt(this.lastSegment(res.headers.location)));
  }

  deleteDeployment(deploymentName) {
    return this
      .request({
        method: 'DELETE',
        url: `/deployments/${deploymentName}`
      }, 302)
      .then(res => parseInt(this.lastSegment(res.headers.location)));
  }

  /* VirtualMachines operations */
  getDeploymentVms(deploymentName) {
    return this
      .request({
        method: 'GET',
        url: `/deployments/${deploymentName}/vms`
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  /* Property operations */
  getDeploymentProperties(deploymentName) {
    return this
      .request({
        method: 'GET',
        url: `/deployments/${deploymentName}/properties`
      }, 200).then(res => JSON.parse(res.body));
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
        .request({
          method: 'GET',
          url: `/deployments/${deploymentName}/instances`,
          qs: {
            format: 'full'
          }
        }, 302)
        .then(res => parseInt(self.lastSegment(res.headers.location)));
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
        pollInterval || config.director.default_task_poll_interval);
    });
  }

  createDeploymentProperty(deploymentName, propertyName, propertyValue) {
    return this
      .request({
        method: 'POST',
        url: `/deployments/${deploymentName}/properties`,
        json: true,
        body: {
          name: propertyName,
          value: propertyValue
        }
      }, 204);
  }

  updateDeploymentProperty(deploymentName, propertyName, propertyValue) {
    return this
      .request({
        method: 'PUT',
        url: `/deployments/${deploymentName}/properties/${propertyName}`,
        json: true,
        body: {
          value: propertyValue
        }
      }, 204);
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
      .request({
        method: 'GET',
        url: `/deployments/${deploymentName}/properties/${propertyName}`
      }, 200)
      .then(res => JSON.parse(res.body).value);
  }

  deleteDeploymentProperty(deploymentName, propertyName) {
    return this
      .request({
        method: 'DELETE',
        url: `/deployments/${deploymentName}/properties/${propertyName}`
      }, 204);
  }

  /*  Task operations */

  getTasks(options) {
    const query = _.assign({
      limit: 1000
    }, options);
    return this
      .request({
        method: 'GET',
        url: '/tasks',
        qs: _.pick(query, ['limit', 'state', 'deployment'])
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  getTask(taskId) {
    return this
      .request({
        method: 'GET',
        url: `/tasks/${taskId}`
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  getTaskResult(taskId) {
    return this
      .request({
        method: 'GET',
        url: `/tasks/${taskId}/output`,
        qs: {
          type: 'result'
        }
      }, 200)
      .then(res => _
        .chain(res.body)
        .split('\n')
        .compact()
        .map(JSON.parse)
        .value()
      );
  }

  getTaskEvents(taskId) {
    return this
      .request({
        method: 'GET',
        url: `/tasks/${taskId}/output`,
        qs: {
          type: 'event'
        }
      }, 200)
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

  lastSegment(url) {
    return _.last(parseUrl(url).path.split('/'));
  }
}

module.exports = BoshDirectorClient;