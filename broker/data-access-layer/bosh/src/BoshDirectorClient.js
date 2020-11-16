'use strict';

const parseUrl = require('url').parse;
const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    Timeout,
    NotFound,
    Conflict,
    ServiceInstanceNotFound,
    UnprocessableEntity,
    BadRequest,
    InternalServerError,
    DirectorServiceUnavailable
  },
  AxiosHttpClient,
  commonFunctions: {
    retry,
    parseServiceInstanceIdFromDeployment,
    taskIdRegExp
  },
  EncryptionManager
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const {
  UaaClient,
  TokenIssuer
} = require('@sf/cf');
const { HttpServer } = require('@sf/express-commons');
const { apiServerClient } = require('@sf/eventmesh');
const BoshSshClient = require('./BoshSshClient');

class BoshDirectorClient extends AxiosHttpClient {
  constructor() {
    super({
      headers: {
        Accept: 'application/json,text/plain;q=0.9'
      },
      maxRedirects: 0
    });
    // primaryConfigs - directors supporting lifecycle oprations
    this.primaryConfigs = BoshDirectorClient.getPrimaryConfigs();
    // activePrimary - directors supporting 'create' oprations
    this.activePrimary = BoshDirectorClient.getActivePrimary();
    // oobDirectorConfigs - directors for OutOfBand backup scenario
    this.oobDirectorConfigs = BoshDirectorClient.getOobDirectorConfigs();
    this.boshConfigCache = {};
    this.deploymentIpsCache = {};
    this.cacheLoadInProgressForDeployment = {};
    this.cacheLoadInProgress = false;
    this.uaaObjects = {};
    // populate UAA objects if uaa based auth is being used by any of the directors
    this.determineDirectorAuthenticationMethod();
    this.ready = config.directors ? this.populateConfigCache() : Promise.resolve({});
  }

  determineDirectorAuthenticationMethod() {
    _.forEach(config.directors, directorConfig => {
      if (_.get(directorConfig, 'uaa.uaa_auth', undefined) === true) {
        let directorName = _.get(directorConfig, 'name', undefined);
        logger.info(`Director ${directorName} uses UAA based authentication. Populating UAA objects in directorConfig.`);
        this.populateUAAObjects(directorConfig);
        if (_.get(this.uaaObjects, `${directorName}.uaaClient`, undefined) instanceof UaaClient &&
          _.get(this.uaaObjects, `${directorName}.tokenIssuer`, undefined) instanceof TokenIssuer) {
          logger.info(`UAA based authentication enabled successfully for ${directorName}.`);
          _.set(directorConfig, 'uaaEnabled', true);
        } else {
          // Fatal error condition. Logging and exiting.
          logger.error(`UAA objects were not populated successfully for bosh ${directorName}. Exiting.`);
          HttpServer.immediateShutdown();
        }
      } else {
        logger.info(`Director ${directorConfig.name} uses basic authentication.`);
      }
    });
  }

  populateUAAObjects(directorConfig) {
    /* Client id and client secret will be used when requesting the token. Here just a sanity check.*/
    let uaaClientId = _.get(directorConfig, 'uaa.client_id', undefined);
    let uaaClientSecret = _.get(directorConfig, 'uaa.client_secret', undefined);
    if (!uaaClientId || !uaaClientSecret) {
      logger.error(`UAA credentials for director ${directorConfig.name} not provided. Error condition.`);
      return;
    }
    /* create uaaClient and tokenIssuer for this director */
    let uaaUrl = _.get(directorConfig, 'uaa.uaa_url', undefined);
    if (!uaaUrl) {
      logger.error('UAA url not provided to populateUAAObjects.');
      return;
    }

    let directorName = _.get(directorConfig, 'name', undefined);
    this.uaaObjects[directorName] = {};
    this.uaaObjects[directorName].uaaClient = new UaaClient({}, uaaUrl);
    this.uaaObjects[directorName].tokenIssuer = new TokenIssuer(this.uaaObjects[directorName].uaaClient);
    this.uaaObjects[directorName].clientId = uaaClientId;
    this.uaaObjects[directorName].clientSecret = uaaClientSecret;

  }

  clearConfigCache(config) {
    if (config) {
      logger.info(`clearing cache for config - ${config.name}`);
      _.each(this.boshConfigCache, (value, key) => _.get(value, 'name') === config.name ? delete this.boshConfigCache[key] : '');
    } else {
      this.boshConfigCache = {};
      logger.info('Cleared Bosh DirectorNames cache...');
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
    return _.head(_.filter(config.directors, director => director.name === name));
  }

  populateConfigCache() {
    logger.debug('Loading Bosh DeploymentName cache... current cached deployments:', _.keys(this.boshConfigCache));
    this.cacheLoadInProgress = true;
    this.clearConfigCache();
    return Promise
      .map(config.directors,
        directorConfig =>
          this.getDeploymentsByConfig(directorConfig)
            .then(deployments => {
              this.updateCache(directorConfig, deployments);
              logger.info('Updated cache for config - ', directorConfig.name);
            }))
      .finally(() => {
        this.cacheLoadInProgress = false;
        logger.info('Clearing cacheLoadInProgress flag. Bosh DeploymentName cache is loaded.');
        logger.silly('Cached Deployments:', _.keys(this.boshConfigCache));
      });
  }

  populateConfigCacheEntry(deploymentName) {
    this.cacheLoadInProgressForDeployment[deploymentName] = true;
    return Promise
      .map(config.directors,
        directorConfig =>
          this.getDeploymentByConfig(deploymentName, directorConfig)
            .then(() => this.updateConfigCacheEntry(deploymentName, directorConfig))
            .catch(NotFound, () => {
              logger.info(`${deploymentName} not found in -`, directorConfig.name);
            }))
      .finally(() => {
        this.cacheLoadInProgressForDeployment[deploymentName] = false;
        delete this.cacheLoadInProgressForDeployment[deploymentName];
        logger.info(`Cache updated for - ${deploymentName}, found in director - ${_.get(this.boshConfigCache[deploymentName], 'name')}`);
      });
  }

  getDeploymentNamesFromCache(boshName, attempt) {
    return Promise.try(() => {
      if (this.cacheLoadInProgress) {
        if (!attempt) {
          attempt = 1;
        } else if (attempt > CONST.BOSH_POLL_MAX_ATTEMPTS) {
          throw Timeout.toManyAttempts(CONST.BOSH_POLL_MAX_ATTEMPTS, new Error('Fetching deployments from Cache is taking too long.'));
        }
        logger.info(`Cache load in progress. GetDeploymentNames will be delayed by 500 ms - current attempt ${attempt}`);
        return Promise.delay(500 * attempt).then(() => this.getDeploymentNamesFromCache(boshName, ++attempt));
      }
      if (boshName) {
        const deploymentNames = [];
        const config = this.getConfigByName(boshName);
        _.each(this.boshConfigCache, (value, key) => value === config ? deploymentNames.push(key) : '');
        return deploymentNames;
      } else {
        return _.keys(this.boshConfigCache);
      }
    });
  }

  updateCache(config, deployments) {
    return Promise.try(() => {
      _.map(deployments, deployment => this.updateConfigCacheEntry(deployment.name, config));
    });
  }

  updateConfigCacheEntry(deployment, config) {
    const directorConfig = this.boshConfigCache[deployment];
    if (directorConfig === undefined) {
      this.boshConfigCache[deployment] = config;
    } else if (_.get(directorConfig, 'name') !== config.name) {
      this.boshConfigCache[deployment] = CONST.ERR_CODES.DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS;
    }
  }

  deleteCacheEntry(deploymentName) {
    return delete this.boshConfigCache[deploymentName];
  }

  getDirectorConfigFromCache(deploymentName, throwExceptionWhenNotFound) {
    const directorConfig = this.boshConfigCache[deploymentName];
    if (directorConfig !== undefined) {
      if (directorConfig === CONST.ERR_CODES.DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS) {
        throw new Conflict(`${deploymentName} is found in more than one of the configured directors. Cant process the request!`);
      }
    } else if (throwExceptionWhenNotFound) {
      logger.error(`Deployment ${deploymentName} not found in configured Bosh directors`);
      throw new NotFound(`Deployment ${deploymentName} not found in configured Bosh directors`);
    }
    return directorConfig;
  }

  getDirectorConfig(deploymentName) {
    return Promise.try(() => {
      logger.debug(`Finding the correct director config for: ${deploymentName}`);
      const directorConfig = this.getDirectorConfigFromCache(deploymentName, false);
      if (directorConfig !== undefined) {
        logger.silly('found director in cache...', directorConfig.name);
        return directorConfig;
      }
      logger.debug(`cache miss for.. ${deploymentName}`);
      if (this.cacheLoadInProgress || this.cacheLoadInProgressForDeployment[deploymentName] === true) {
        logger.debug(`Cache load in progress...  CacheLoadInProgressForDeployment[${deploymentName}]  - ${this.cacheLoadInProgressForDeployment[deploymentName]}`);
        return Promise.delay(500).then(() => this.getDirectorConfig(deploymentName));
      }
      return this
        .populateConfigCacheEntry(deploymentName)
        .then(() => this.getDirectorConfigFromCache(deploymentName, true));
    });
  }

  makeRequest(requestDetails, expectedStatusCode, deploymentName, attempt) {
    return this.getDirectorConfig(deploymentName)
      .then(directorConfig => this.makeRequestWithConfig(requestDetails, expectedStatusCode, directorConfig))
      .catch(NotFound, err => {
        if (attempt === undefined && _.get(err, 'error.code') === CONST.BOSH_ERR_CODES.DEPLOYMENT_NOT_FOUND) {
          logger.info('Going to delete the entry from cache for the deployment:', deploymentName);
          this.deleteCacheEntry(deploymentName);
          return this.makeRequest(requestDetails, expectedStatusCode, deploymentName, 1);
        } else if (attempt) {
          logger.warn(`Request ${JSON.stringify(requestDetails)} - on deployment ${deploymentName} resulted in 404. Attempt - ${attempt} -  error details`, err.error);
        }
        throw err;
      });
  }

  makeRequestWithConfig(requestDetails, expectedStatusCode, directorConfig) {
    requestDetails.baseURL = directorConfig.url;
    requestDetails.rejectUnauthorized = !directorConfig.skip_ssl_validation;
    if (directorConfig.uaaEnabled) {
      let directorName = _.get(directorConfig, 'name', undefined);
      let clientId = this.uaaObjects[directorName].clientId;
      let clientSecret = this.uaaObjects[directorName].clientSecret;
      let tokenIssuer = this.uaaObjects[directorName].tokenIssuer;
      return Promise.try(() => tokenIssuer.getAccessTokenBoshUAA(clientId, clientSecret))
        .then(accessToken => {
          // Adding access token to authorization header
          requestDetails.auth = false;
          _.set(requestDetails, 'headers.authorization', `Bearer ${accessToken}`);
          return this.request(requestDetails, expectedStatusCode);
        });
    } else {
      requestDetails.auth = {
        username: directorConfig.username,
        password: directorConfig.password
      };
      return this.request(requestDetails, expectedStatusCode);
    }
  }

  getInfo() {
    return this
      .makeRequestWithConfig({
        method: 'GET',
        url: '/info'
      }, 200, _.sample(this.activePrimary))
      .then(res => res.body);
  }

  /* Deployment operations */

  getDeploymentsByConfig(config) {
    return this
      .makeRequestWithConfig({
        method: 'GET',
        url: '/deployments'
      }, 200, config)
      .then(res => res.body);
  }

  getDeploymentByConfig(deploymentName, config) {
    logger.debug('deployment name:', deploymentName);
    return this
      .makeRequestWithConfig({
        method: 'GET',
        url: `/deployments/${deploymentName}`
      }, 200, config)
      .then(res => res.body);
  }

  getDeployments() {
    return Promise
      .map(this.primaryConfigs,
        directorConfig => this.getDeploymentsByConfig(directorConfig))
      .reduce((all_deployments, deployments) => all_deployments.concat(deployments), [])
      .catch(err => this.convertHttpErrorAndThrow(err));
  }

  getDeploymentNameForInstanceId(guid) {
    logger.debug(`Finding deployment name for instance id : '${guid}'`);
    return Promise.try(() => {
      const match = _
        .chain(this.boshConfigCache)
        .keys()
        .filter(name => _.endsWith(name, guid))
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
            throw new ServiceInstanceNotFound(guid);
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

  getDeployment(deploymentName) {
    return this
      .makeRequest({
        method: 'GET',
        url: `/deployments/${deploymentName}`
      }, 200, deploymentName)
      .then(res => res.body);
  }

  diffDeploymentManifest(deploymentName, manifest) {
    return this
      .makeRequest({
        method: 'POST',
        url: `/deployments/${deploymentName}/diff`,
        headers: {
          'Content-Type': 'text/yaml'
        },
        params: {
          redact: 'false'
        },
        data: _.isObject(manifest) ? yaml.safeDump(manifest) : manifest
      }, 200, deploymentName)
      .then(res => res.body);
  }


  getDeploymentManifest(deploymentName) {
    logger.debug(`Fetching deployment manifest ${deploymentName}`);
    return this
      .getDeployment(deploymentName)
      .then(deployment => deployment.manifest ?
        yaml.safeLoad(deployment.manifest) : null
      );
  }

  /**
   * Fetch the director config for the operation and deployment
   * 
   * @param {string} action - type of action [create, update, delete]
   * @param {string} deploymentName - name of BOSH deployment 
   */
  getDirectorForOperation(action, deploymentName) {
    logger.debug(`Fetching director for operation ${action} and deployment ${deploymentName}`);
    return Promise.try(() => {
      if (action === CONST.OPERATION_TYPE.CREATE) {
        return _.sample(this.activePrimary);
      } else {
        return this.getDirectorConfig(deploymentName);
      }
    });
  }

  /** 
   * get the current tasks in the director (in processing, cancelling state)
   * task count should be retrieved for ALL types of operations
   * 
   */
  getCurrentTasks(action, directorConfig, ...states) {
    let stateQuery = `${CONST.BOSH_RATE_LIMITS.BOSH_PROCESSING},${CONST.BOSH_RATE_LIMITS.BOSH_CANCELLING}`;
    if (states.length > 0) {
      stateQuery = states.join(',');
    }
    const query = {
      state: stateQuery,
      verbose: 2
    };
    return this.makeRequestWithConfig({
      method: 'GET',
      url: '/tasks',
      params: query
    }, 200, directorConfig)
      .then(res => res.body)
      .then(out => {
        // out is the array of currently running tasks
        let taskGroup = _.groupBy(out, entry => {
          switch (entry.context_id) {
            case CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP_AUTO:
              return CONST.FABRIK_SCHEDULED_OPERATION;
            case `${CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP}${CONST.OPERATION_TYPE.CREATE}`:
              return CONST.OPERATION_TYPE.CREATE;
            case `${CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP}${CONST.OPERATION_TYPE.UPDATE}`:
              return CONST.OPERATION_TYPE.UPDATE;
            case `${CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP}${CONST.OPERATION_TYPE.DELETE}`:
              return CONST.OPERATION_TYPE.DELETE;
            default:
              return CONST.UNCATEGORIZED;
          }
        });
        return {
          'create': taskGroup[CONST.OPERATION_TYPE.CREATE] ? taskGroup[CONST.OPERATION_TYPE.CREATE].length : 0,
          'delete': taskGroup[CONST.OPERATION_TYPE.DELETE] ? taskGroup[CONST.OPERATION_TYPE.DELETE].length : 0,
          'update': taskGroup[CONST.OPERATION_TYPE.UPDATE] ? taskGroup[CONST.OPERATION_TYPE.UPDATE].length : 0,
          'scheduled': taskGroup[CONST.FABRIK_SCHEDULED_OPERATION] ? taskGroup[CONST.FABRIK_SCHEDULED_OPERATION].length : 0,
          'uncategorized': taskGroup[CONST.UNCATEGORIZED] ? taskGroup[CONST.UNCATEGORIZED].length : 0,
          'total': out.length
        };
      });
  }

  createOrUpdateDeployment(action, manifest, opts, scheduled) {
    const query = opts ? ((action === CONST.OPERATION_TYPE.CREATE) ? _.pick(opts, 'recreate', 'skip_drain', 'context', 'canaries', 'max_in_flight') : _.pick(opts, 'recreate', 'skip_drain', 'context')) : undefined;
    const deploymentName = yaml.safeLoad(manifest).name;
    const boshDirectorName = _.get(opts, 'bosh_director_name');
    delete this.deploymentIpsCache[deploymentName];
    return Promise.try(() => {
      if (action === CONST.OPERATION_TYPE.CREATE) {
        if (boshDirectorName) {
          return this.getConfigByName(boshDirectorName);
        } else {
          return _.sample(this.activePrimary);
        }
      } else {
        return this
          .getDirectorConfig(deploymentName);
      }
    })
      .then(config => {
        if (config === undefined) {
          throw new NotFound('Did not find any bosh director config which supports creation of deployment');
        }
        const reqHeaders = {
          'Content-Type': 'text/yaml'
        };
        if (scheduled) {
          reqHeaders[CONST.BOSH_RATE_LIMITS.BOSH_CONTEXT_ID] = CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP_AUTO;
        } else {
          reqHeaders[CONST.BOSH_RATE_LIMITS.BOSH_CONTEXT_ID] = `${CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP}${action}`;
        }
        return this
          .makeRequestWithConfig({
            method: 'POST',
            url: '/deployments',
            headers: reqHeaders,
            params: query,
            data: _.isObject(manifest) ? yaml.safeDump(manifest) : manifest
          }, 302, config)
          .tap(() => {
            logger.info(`Cached ${deploymentName} at director: ${config.name} ${config.url}`);
            this.boshConfigCache[deploymentName] = config;
          })
          .then(res => this.prefixTaskId(deploymentName, res));
      })
      .catch(err => this.convertHttpErrorAndThrow(err));
  }

  deleteDeployment(deploymentName) {
    delete this.deploymentIpsCache[deploymentName];
    return this
      .makeRequest({
        method: 'DELETE',
        url: `/deployments/${deploymentName}`
      }, 302, deploymentName)
      .then(res => this.prefixTaskId(deploymentName, res))
      .catch(err => this.convertHttpErrorAndThrow(err));
  }

  /* VirtualMachines operations */
  getDeploymentVms(deploymentName) {
    return this
      .makeRequest({
        method: 'GET',
        url: `/deployments/${deploymentName}/vms`
      }, 200, deploymentName)
      .then(res => res.body);
  }

  getDeploymentInstances(deploymentName) {
    return this
      .makeRequest({
        method: 'GET',
        url: `/deployments/${deploymentName}/instances`
      }, 200, deploymentName)
      .then(res => res.body)
      .catch(err => this.convertHttpErrorAndThrow(err));
  }

  getDeploymentIps(deploymentName) {
    return Promise.try(() => {
      if (this.deploymentIpsCache[deploymentName] !== undefined) {
        return this.deploymentIpsCache[deploymentName];
      } else {
        return this.getDeploymentIpsFromResource(deploymentName)
          .then(ips => {
            if (!_.isEmpty(ips)) {
              logger.info(`[getDeploymentIps] Cached Ips for deployment - ${deploymentName} - `, ips);
              this.deploymentIpsCache[deploymentName] = ips;
              return ips;
            } else {
              return this.getDeploymentIpsFromDirector(deploymentName)
                .then(ips => {
                  logger.info('[getDeploymentIps] Caching IPs on ApiServer and locally');
                  this.deploymentIpsCache[deploymentName] = ips;
                  return this.putDeploymentIpsInResource(deploymentName, ips)
                    .then(() => ips);
                });
            }
          });
      }
    });
  }

  getDeploymentIpsFromResource(deploymentName) {
    logger.info(`[getDeploymentIps] making request to ApiServer for deployment - ${deploymentName}`);
    let resourceId = parseServiceInstanceIdFromDeployment(deploymentName);
    if (deploymentName === resourceId) {
      // don't contact to ApiServer if it is out-of-band deployment
      return Promise.resolve();
    }
    return apiServerClient.getResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      resourceId: resourceId
    })
      .then(resource => JSON.parse(_.get(resource, 'metadata.annotations.deploymentIps', '{}')))
      .catch(err => {
        logger.error(`[getDeploymentIps] Error occurred while getting deployment Ips for ${deploymentName} from ApiServer`, err);
        return;
      });
  }

  putDeploymentIpsInResource(deploymentName, ips) {
    let resourceId = parseServiceInstanceIdFromDeployment(deploymentName);
    if (deploymentName === resourceId) {
      // don't contact to ApiServer if it is out-of-band deployment
      return Promise.resolve();
    }
    return apiServerClient.updateResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      resourceId: resourceId,
      metadata: {
        annotations: {
          deploymentIps: JSON.stringify(ips)
        }
      }
    })
      .catch(err => {
        logger.error(`[getDeploymentIps] Error occured while updating resource for ${deploymentName} on ApiServer`, err);
        return;
      });
  }

  getDeploymentIpsFromDirector(deploymentName) {
    logger.info(`[getDeploymentIps] making request to director for deployment - ${deploymentName}`);
    return this
      .getDeploymentInstances(deploymentName)
      .reduce((ipList, instance) => ipList.concat(instance.ips), [])
      .tap(response => {
        logger.info(`Cached Ips for deployment - ${deploymentName} - `, response);
        this.deploymentIpsCache[deploymentName] = response;
      });
  }

  getAgentPropertiesFromManifest(deploymentName) {
    return this.getDeploymentManifest(deploymentName)
      .tap(manifest => {
        if (_.isNil(manifest)) {
          throw new BadRequest(`The deployment ${deploymentName} does not exist`);
        }
      })
      .then(manifest => {
        if (manifest.instance_groups) {
          let agentJob = {};
          _.each(manifest.instance_groups, instance_group => {
            agentJob = _.find(instance_group.jobs, job => job.name === CONST.AGENT.NAME);
            return !agentJob;
          });
          return agentJob.properties.agent || agentJob.properties;
        } else {
          // This section has been retained to support backward compatibility for instances of bosh v1 manifest.
          // TODO: this must be removed once the migration to bosh v2 manifest is done to avoid confusion. 
          return manifest.properties.agent;
        }
      });
  }

  getNormalizedDeploymentVms(deploymentName) {
    function normalizeVm(vm) {
      let vmParams = _.pick(vm, 'cid', 'agent_id', 'job', 'index');
      return _.set(vmParams, 'iaas_vm_metadata.vm_id', config.backup.provider.name === CONST.IAAS.AZURE ? vmParams.agent_id : vmParams.cid);
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
          params: {
            format: 'full'
          }
        }, 302, deploymentName)
        .then(res => self.prefixTaskId(deploymentName, res));
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
              case 'timeout': {
                clearInterval(timer);
                const errMsg = `Task ${task.deployment} failed at ${timestamp} with error "${task.result}"`;
                logger.error(errMsg);
                return reject(new Error(errMsg), task);
              }
              default: {
                const time = Date.now() - startTime;
                if (time >= (timeout || Infinity)) {
                  logger.error(`deployment ${task.deployment} failed! Failed to provision MongoDB!`);
                  return reject(Timeout.timedOut(time), task);
                }
                logger.debug(`Task ${task.deployment} - is still - ${task.state}. Task state polling will continue...`);
              }
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

  /*  Task operations */

  getTasks(options, fetchDirectorForDeployment) {
    const query = _.assign({
      limit: 1000
    }, options);
    return Promise.try(() => fetchDirectorForDeployment ? this.getDirectorConfig(options.deployment) : this.primaryConfigs)
      .then(configs => Array.isArray(configs) ? configs : [configs])
      .map(directorConfig => {
        return this
          .makeRequestWithConfig({
            method: 'GET',
            url: '/tasks',
            params: _.pick(query, ['limit', 'state', 'deployment'])
          }, 200, directorConfig)
          .then(res => res.body)
          .map(task => {
            task.id = `${options.deployment}_${task.id}`;
            return task;
          });
      })
      .reduce((all_tasks, tasks) => all_tasks.concat(tasks), [])
      .catch(err => this.convertHttpErrorAndThrow(err));
  }

  getTask(taskId) {
    const splitArray = this.parseTaskid(taskId);
    if (splitArray === null) {
      // Required format is deploymentName_taskId.
      throw new UnprocessableEntity(`Not able to query correct bosh as taskId is not in required format: ${taskId}.`);
    }
    const deploymentName = splitArray[1];
    const taskIdAlone = splitArray[2];
    return this
      .makeRequest({
        method: 'GET',
        url: `/tasks/${taskIdAlone}`
      }, 200, deploymentName)
      .then(res => res.body);
  }

  getTaskResult(taskId) {
    const splitArray = this.parseTaskid(taskId);
    if (splitArray === null) {
      // Required format is deploymentName_taskId.
      throw new UnprocessableEntity(`Not able to query correct bosh as taskId is not in required format: ${taskId}.`);
    }
    const deploymentName = splitArray[1];
    const taskIdAlone = splitArray[2];
    return this
      .makeRequest({
        method: 'GET',
        url: `/tasks/${taskIdAlone}/output`,
        params: {
          type: 'result'
        },
        responseType: 'text'
      }, 200, deploymentName)
      .then(res => _
        .chain(res.body)
        .split('\n')
        .compact()
        .map(JSON.parse)
        .value()
      );
  }

  startDeployment(deploymentName) {
    return this
      .getDirectorConfig(deploymentName)
      .then(config => this.invokeDeploymentJobAction(config, deploymentName, CONST.BOSH_DEPLOYMENT_ACTIONS.STARTED));
  }

  stopDeployment(deploymentName) {
    return this
      .getDirectorConfig(deploymentName)
      .then(config => this.invokeDeploymentJobAction(config, deploymentName, CONST.BOSH_DEPLOYMENT_ACTIONS.STOPPED));
  }

  invokeDeploymentJobAction(directorConfig, deploymentName, expectedState) {
    return this
      .makeRequestWithConfig({
        method: 'PUT',
        url: `/deployments/${deploymentName}/jobs/*`,
        headers: {
          'content-type': 'text/yaml'
        },
        params: {
          'state': expectedState
        }
      }, 302, directorConfig)
      .then(res => {
        const taskId = this.lastSegment(res.headers.location);
        logger.info(`Sent signal to ${deploymentName} for result state ${expectedState}, BOSH task ID: ${taskId}`);
        return this.prefixTaskId(deploymentName, res);
      });
  }

  setupSsh(deploymentName, jobName, instanceId, tempUser, publicKey) {
    return this.makeRequest({ // jshint ignore: line
      method: 'POST',
      url: `/deployments/${deploymentName}/ssh`,
      data: {
        command: 'setup',
        deployment_name: deploymentName,
        target: {
          job: jobName,
          ids: [instanceId]
        },
        params: {
          user: tempUser,
          public_key: publicKey
        }
      },
      headers: {
        'Content-type': 'application/json'
      },
      responseType: 'json'
    }, CONST.HTTP_STATUS_CODE.FOUND, deploymentName);
  }

  cleanupSsh(deploymentName, jobName, instanceId, tempUser) {
    return this.makeRequest({
      method: 'POST',
      url: `/deployments/${deploymentName}/ssh`,
      data: {
        command: 'cleanup',
        deployment_name: deploymentName,
        target: {
          job: jobName,
          ids: [instanceId]
        },
        params: {
          user_regex: `^${tempUser}`
        }
      },
      headers: {
        'Content-type': 'application/json'
      },
      responseType: 'json'
    }, CONST.HTTP_STATUS_CODE.FOUND, deploymentName);
  }

  async runSsh(deploymentName, jobName, instanceId, command) { // jshint ignore: line
    const cryptoManager = new EncryptionManager();
    /* temporary username below is clipped to length of 16 characters to satisfy restrictions (32 chars) on length
       by useradd command used on destination instances */
    const tempUser = `sf-${Math.random().toString(36).substring(2, 15)}`;
    const genKeyPair = await cryptoManager.generateSshKeyPair(tempUser); // jshint ignore: line
    const sshSetupResponse = await this.setupSsh(deploymentName, jobName, instanceId, tempUser, genKeyPair.publicKey); // jshint ignore: line
    const sshSetupTaskId = this.prefixTaskId(deploymentName, sshSetupResponse);
    await this.pollTaskStatusTillComplete(sshSetupTaskId, 2000); // jshint ignore: line
    const sshSetupResult = await this.getTaskResult(sshSetupTaskId); // jshint ignore: line
    const sshOptions = {
      host: sshSetupResult[0][0].ip,
      username: tempUser,
      privateKey: genKeyPair.privateKey
    };
    const boshDeploymentOptions = {
      deploymentName: deploymentName,
      job: jobName,
      instanceId: instanceId
    };
    const boshSshClient = new BoshSshClient(sshOptions, boshDeploymentOptions);
    const sshOutput = await boshSshClient.run(command); // jshint ignore: line
    await this.cleanupSsh(deploymentName, jobName, instanceId, tempUser); // jshint ignore: line
    return sshOutput;
  }

  getDeploymentErrands(deploymentName) {
    return this.makeRequest({
      method: 'GET',
      url: `/deployments/${deploymentName}/errands`
    }, CONST.HTTP_STATUS_CODE.OK, deploymentName)
      .then(res => res.body);
  }

  /**
   * Trigger the errand on specific instances and get the task id correspnding to errand
   * @param {string} deploymentName - Deployment on which errand is to be started
   * @param {string} errandName - errand name
   * @param {Object[]}  instances - array of the instances on which the errand is to be triggered
   * @param {string}  instances[].group - instance group
   * @param {string}  instances[].id - instance index or id
   */
  runDeploymentErrand(deploymentName, errandName, instances = []) {
    return this.makeRequest({
      method: 'POST',
      url: `/deployments/${deploymentName}/errands/${errandName}/runs`,
      data: {
        'keep-alive': true,
        'instances': instances
      },
      headers: {
        'Content-type': 'application/json'
      },
      responseType: 'json'
    }, CONST.HTTP_STATUS_CODE.FOUND, deploymentName)
      .then(res => {
        const taskId = this.lastSegment(res.headers.location);
        logger.info(`Triggered errand ${errandName} on instances ${instances} of deployment ${deploymentName}. Task Id: ${taskId}.`);
        return this.prefixTaskId(deploymentName, res);
      });
  }

  createDiskAttachment(deploymentName, diskCid, jobName, instanceId, diskProperties = 'copy') {
    return this.makeRequest({
      method: 'PUT',
      url: `/disks/${diskCid}/attachments`,
      params: {
        deployment: deploymentName,
        job: jobName,
        instance_id: instanceId,
        disk_properties: diskProperties || 'copy'
      }
    }, CONST.HTTP_STATUS_CODE.FOUND, deploymentName)
      .then(res => {
        const taskId = this.lastSegment(res.headers.location);
        logger.info(`Triggered disk attachment with paramaters --> \
        deploymentName: ${deploymentName}, jobName: ${jobName}, instanceId: ${instanceId}, diskCid: ${diskCid}. Task Id: ${taskId}.`);
        return this.prefixTaskId(deploymentName, res);
      });
  }

  getPersistentDisks(deploymentName, instanceFilter = []) {
    if (!instanceFilter || !_.isArray(instanceFilter)) {
      instanceFilter = [];
    }
    return this.getDeploymentVmsVitals(deploymentName)
      .then(instances => _.filter(instances, instance => _.includes(instanceFilter, instance.job_name)))
      .then(filteredInstances => {
        return _.chain(filteredInstances)
          .map(i => ({
            job_name: _.get(i, 'job_name'),
            id: _.get(i, 'id'),
            disk_cid: _.get(i, 'disk_cid'),
            az: _.get(i, 'cloud_properties.availability_zone') || _.get(i, 'cloud_properties.zone')
          }))
          .value();
      });
  }

  getTaskEvents(taskId) {
    const splitArray = this.parseTaskid(taskId);
    if (splitArray === null) {
      // Required format is deploymentName_taskId.
      throw new UnprocessableEntity(`Not able to query correct bosh as taskId is not in required format: ${taskId}.`);
    }
    const deploymentName = splitArray[1];
    const taskIdAlone = splitArray[2];
    return this
      .makeRequest({
        method: 'GET',
        url: `/tasks/${taskIdAlone}/output`,
        params: {
          type: 'event'
        }
      }, 200, deploymentName)
      .then(res => {
        let events = [];
        _.trim(res.body).split('\n').forEach(event => {
          try {
            events.push(JSON.parse(event));
          } catch (err) {
            logger.error(`Error parsing task ${taskId} event ${event}: event response - ${res.body} `, err);
          }
        });
        return events;
      });
  }

  parseTaskid(prefixedTaskid) {
    // slice 1 - deploymentName
    // slice 2 - taskId
    return taskIdRegExp().exec(prefixedTaskid);
  }

  prefixTaskId(deploymentName, res) {
    return `${deploymentName}_${this.lastSegment(res.headers.location)}`;
  }

  lastSegment(url) {
    return _.last(parseUrl(url).path.split('/'));
  }

  convertHttpErrorAndThrow(err) {
    if ((err instanceof InternalServerError) || _.includes(CONST.SYSTEM_ERRORS, err.code)) {
      throw new DirectorServiceUnavailable(err.message);
    } else {
      throw err;
    }
  }
}

module.exports = BoshDirectorClient;
