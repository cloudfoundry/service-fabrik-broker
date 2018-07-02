'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const BaseInstance = require('./BaseInstance');
const config = require('../config');
const logger = require('../logger');
const errors = require('../errors');
const jwt = require('../jwt');
const utils = require('../utils');
const catalog = require('../models').catalog;
const NotFound = errors.NotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const ScheduleManager = require('../jobs');
const CONST = require('../constants');
const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

class DirectorInstance extends BaseInstance {
  constructor(guid, manager) {
    super(guid, manager);
    this.networkSegmentIndex = undefined;
  }

  get platformContext() {
    return Promise.try(() => this.networkSegmentIndex ? this.deploymentName : this.manager.director.getDeploymentNameForInstanceId(this.guid))
      .then(deploymentName => this.manager.director.getDeploymentProperty(deploymentName, CONST.PLATFORM_CONTEXT_KEY))
      .then(context => JSON.parse(context))
      .catch(NotFound, () => {
        /* Following is to handle existing deployments. 
           For them platform-context is not saved in deployment property. Defaults to CF.
         */
        logger.warn(`Deployment property '${CONST.PLATFORM_CONTEXT_KEY}' not found for instance '${this.guid}'.\ 
        Setting default platform as '${CONST.PLATFORM.CF}'`);

        const context = {
          platform: CONST.PLATFORM.CF
        };
        return context;
      });
  }

  static get typeDescription() {
    return 'deployment';
  }

  get deploymentName() {
    return this.manager.getDeploymentName(this.guid, this.networkSegmentIndex);
  }

  get async() {
    if (config.enable_service_fabrik_v2) {
      return true;
      //Backup operation is being turned into SYNCH and behind the scenes polling will happen to check status.
      //Rationale : Bind operations can happen while backups are happening.
    } else {
      return this.operation !== CONST.OPERATION_TYPE.BACKUP && this.operation !== CONST.OPERATION_TYPE.UNLOCK;
      //Backup/Unlock operation is being turned into SYNCH and behind the scenes polling will happen to check status.
      //Rationale : Bind operations can happen while backups are happening.
    }
  }

  initialize(operation) {
    return Promise
      .try(() => {
        this.operation = operation.type;
        if (operation.type === 'create') {
          return this.manager.aquireNetworkSegmentIndex(this.guid);
        }
        return this.manager.findNetworkSegmentIndex(this.guid);
      })
      .tap(networkSegmentIndex => {
        assert.ok(_.isInteger(networkSegmentIndex), `Network segment index '${networkSegmentIndex}' must be an integer`);
        this.networkSegmentIndex = networkSegmentIndex;
      })
      .tap(() => {
        if (operation.type === 'delete') {
          return Promise
            .all([
              this.platformManager.preInstanceDeleteOperations({
                guid: this.guid
              }),
              this.deleteRestoreFile()
            ]);
        }
      });
  }

  deleteRestoreFile() {
    if (_.includes(this.manager.agent.features, 'backup')) {
      return Promise.try(() => this.platformManager.ensureTenantId({
          context: this.platformContext,
          guid: this.guid
        }))
        .then(tenant_id => tenant_id ? this.manager.deleteRestoreFile(tenant_id, this.guid) : Promise.resolve({}))
        .catch(err => {
          logger.error(`Failed to delete restore file of instance '${this.guid}'`);
          logger.error(err);
          throw err;
        });
    }
  }

  finalize(operation) {
    const action = _.capitalize(operation.type);
    return Promise
      .try(() => {
        switch (operation.type) {
        case 'create':
          return utils
            .retry(tries => {
              logger.info(`+-> ${ordinals[tries]} attempt to create property '${CONST.PLATFORM_CONTEXT_KEY}' for deployment '${this.deploymentName}'...`);
              return this.manager.director
                .createDeploymentProperty(this.deploymentName, CONST.PLATFORM_CONTEXT_KEY, JSON.stringify(operation.context))
                .catch(err => {
                  logger.error(err);
                  throw err;
                });
            }, {
              maxAttempts: 3,
              minDelay: 1000
            })
            .then(() => this.platformManager.postInstanceProvisionOperations({
              ipRuleOptions: this.buildIpRules(),
              guid: this.guid,
              context: operation.context
            }))
            .tap(() => operation.state === CONST.OPERATION.SUCCEEDED ? this.scheduleAutoUpdate() : {});

        case 'update':
          return this.platformManager.postInstanceUpdateOperations({
            ipRuleOptions: this.buildIpRules(),
            guid: this.guid,
            context: operation.context
          });
        }
      })
      .catch(err => _.assign(operation, {
        state: 'failed',
        description: `${action} deployment '${this.deploymentName}' not yet completely succeeded because "${err.message}"`
      }));
  }

  create(params) {
    const operation = {
      type: 'create'
    };
    return this
      .initialize(operation)
      .then(() => {
        return this.manager
          .createOrUpdateDeployment(this.deploymentName, params);
      })
      .then(op => _
        .chain(operation)
        .assign(_.pick(params, 'parameters', 'context'))
        .set('task_id', op.task_id)
        .set('cached', op.cached)
        .value()
      );
  }

  update(params) {
    if (config.enable_service_fabrik_v2) {
      return this.update20(params);
    }
    return this.update10(params);
  }
  update10(params) {
    const operation = {
      type: 'update'
    };
    // service fabrik operation token
    const token = _.get(params.parameters, 'service-fabrik-operation', null);
    if (token) {
      _.unset(params.parameters, 'service-fabrik-operation');
      _.set(params, 'scheduled', true);
    }
    return this
      .initialize(operation)
      .then(() => token ? jwt.verify(token, config.password) : null)
      .then(serviceFabrikOperation => {
        logger.info('SF Operation input:', serviceFabrikOperation);
        this.operation = _.get(serviceFabrikOperation, 'name', 'update');
        const deploymentLockPromise = (this.operation === CONST.OPERATION_TYPE.UNLOCK) ?
          Promise.resolve({}) :
          Promise.try(() => this.manager.verifyDeploymentLockStatus(this.deploymentName));
        return deploymentLockPromise.return(serviceFabrikOperation);
      })
      .then(serviceFabrikOperation => {
        // normal update operation
        if (this.operation === 'update') {
          const args = _.get(serviceFabrikOperation, 'arguments');
          return this.manager
            .createOrUpdateDeployment(this.deploymentName, params, args)
            .then(op => _
              .chain(operation)
              .assign(_.pick(params, 'parameters', 'context'))
              .set('task_id', op.task_id)
              .set('cached', op.cached)
              .value()
            );
        }
        // service fabrik operation
        const previousValues = params.previous_values;
        const opts = _
          .chain(previousValues)
          .pick('plan_id', 'service_id')
          .set('context', params.context)
          .set('instance_guid', this.guid)
          .set('deployment', this.deploymentName)
          .assign(_.omit(serviceFabrikOperation, 'name'))
          .value();
        return this.manager
          .invokeServiceFabrikOperation(this.operation, opts)
          .then(result => _
            .chain(operation)
            .assign(result)
            .set('username', serviceFabrikOperation.username)
            .set('useremail', serviceFabrikOperation.useremail)
            .set('context', params.context)
            .value()
          );
      });
  }

  update20(params) {
    const operation = {
      type: 'update'
    };
    // service fabrik operation token
    const token = _.get(params.parameters, 'service-fabrik-operation', null);
    if (token) {
      _.unset(params.parameters, 'service-fabrik-operation');
      _.set(params, 'scheduled', true);
    }
    return this
      .initialize(operation)
      .then(() => token ? jwt.verify(token, config.password) : null)
      .then(serviceFabrikOperation => {
        logger.info('SF Operation input:', serviceFabrikOperation);
        this.operation = _.get(serviceFabrikOperation, 'name', 'update');
        // normal update operation
        if (this.operation === 'update') {
          const args = _.get(serviceFabrikOperation, 'arguments');
          return this.manager
            .createOrUpdateDeployment(this.deploymentName, params, args)
            .then(op => _
              .chain(operation)
              .assign(_.pick(params, 'parameters', 'context'))
              .set('task_id', op.task_id)
              .set('cached', op.cached)
              .value()
            );
        }
        // service fabrik operation
        const previousValues = params.previous_values;
        const opts = _
          .chain(previousValues)
          .pick('plan_id', 'service_id')
          .set('context', params.context)
          .set('instance_guid', this.guid)
          .set('deployment', this.deploymentName)
          .assign(_.omit(serviceFabrikOperation, 'name'))
          .value();
        return this.manager
          .invokeServiceFabrikOperation(this.operation, opts)
          .then(result => _
            .chain(operation)
            .assign(result)
            .set('username', serviceFabrikOperation.username)
            .set('useremail', serviceFabrikOperation.useremail)
            .set('context', params.context)
            .value()
          );
      });
  }

  delete(params) {
    if (config.enable_service_fabrik_v2) {
      return this.delete20(params);
    }
    return this.delete10(params);
  }

  delete10(params) {
    const operation = {
      type: 'delete'
    };
    return this
      .initialize(operation)
      .then(() => this.manager.verifyDeploymentLockStatus(this.deploymentName))
      .then(() => this.manager.deleteDeployment(this.deploymentName, params))
      .then(taskId => _
        .chain(operation)
        .set('task_id', taskId)
        .set('context', {
          platform: this.platformManager.platform
        })
        .value()
      );
  }

  delete20(params) {
    const operation = {
      type: 'delete'
    };
    return this
      .initialize(operation)
      .then(() => this.manager.deleteDeployment(this.deploymentName, params))
      .then(taskId => _
        .chain(operation)
        .set('task_id', taskId)
        .set('context', {
          platform: this.platformManager.platform
        })
        .value()
      );
  }

  getBoshTaskStatus(instanceId, operation, taskId) {
    return Promise
      .try(() => {
        assert.ok(taskId, 'Task ID must be available');
        return this.manager.getTask(taskId);
      })
      .catchThrow(NotFound, new ServiceInstanceNotFound(instanceId))
      .then(task => {
        assert.ok(_.endsWith(task.deployment, this.guid), `Deployment '${task.deployment}' must end with '${this.guid}'`);
        this.networkSegmentIndex = this.manager.getNetworkSegmentIndex(task.deployment);
        this.setOperationState(operation, task);
        if (operation.state !== 'in progress') {
          return Promise.try(() => {
              return this.manager.cleanupOperation(task.deployment);
            })
            .then(() => this.finalize(operation));
        }
      })
      .return(operation);
  }

  lastOperation(operation) {
    if (operation.type === 'update' && _.has(operation, 'subtype')) {
      logger.info('Fetching state of last service fabrik operation', operation);
      return this.manager
        .getServiceFabrikOperationState(operation.subtype, _
          .chain(operation)
          .omit('subtype')
          .set('instance_guid', this.guid)
          .value()
        );
    }
    logger.info('Fetching state of last operation', operation);
    const instanceId = this.guid;

    if (operation.task_id) {
      return this.getBoshTaskStatus(instanceId, operation, operation.task_id);
    } else {
      return Promise.try(() => {
        return this.manager.getCurrentOperationState(this.guid);
      }).then(state => {
        const isCached = state.cached;
        const taskId = state.task_id;
        if (isCached) {
          return _.assign(operation, {
            description: `${_.capitalize(operation.type)} deployment is still in progress`,
            state: 'in progress'
          });
        } else {
          return this.getBoshTaskStatus(instanceId, operation, taskId);
        }
      });
    }
  }

  setOperationState(operation, task) {
    const action = _.capitalize(operation.type);
    const timestamp = new Date(task.timestamp * 1000).toISOString();
    switch (task.state) {
    case 'done':
      return _.assign(operation, {
        description: `${action} deployment ${task.deployment} succeeded at ${timestamp}`,
        state: 'succeeded'
      });
    case 'error':
    case 'cancelled':
    case 'timeout':
      return _.assign(operation, {
        description: `${action} deployment ${task.deployment} failed at ${timestamp} with Error "${task.result}"`,
        state: 'failed'
      });
    default:
      return _.assign(operation, {
        description: `${action} deployment ${task.deployment} is still in progress`,
        state: 'in progress'
      });
    }
  }

  bind(params) {
    return this
      .initialize({
        type: 'bind'
      })
      .then(() => this.manager.createBinding(this.deploymentName, {
        id: params.binding_id,
        parameters: params.parameters || {}
      }))
      .tap(() => this
        .scheduleBackUp()
        .catch(() => {}));
  }

  unbind(params) {
    return this
      .initialize({
        type: 'unbind'
      })
      .then(() => this.manager.deleteBinding(this.deploymentName, params.binding_id));
  }

  getApplicationAccessPortsOfService() {
    let service = this.manager.service.toJSON();
    return _.get(service, 'application_access_ports');
  }

  buildIpRules() {
    let applicationAccessPorts = this.getApplicationAccessPortsOfService();
    return _.map(this.manager.getNetwork(this.networkSegmentIndex), net => {
      return {
        protocol: 'tcp',
        ips: net.static,
        applicationAccessPorts: applicationAccessPorts
      };
    });
  }

  getInfo() {
    const operation = {
      type: 'get'
    };
    return Promise
      .all([
        this.cloudController.getServiceInstance(this.guid)
        .then(instance => this.cloudController.getServicePlan(instance.entity.service_plan_guid, {})
          .then(plan => {
            return {
              'instance': instance,
              'plan': plan
            };
          })
        ),
        this.initialize(operation).then(() => this.manager.getDeploymentInfo(this.deploymentName))
      ])
      .spread((instanceInfo, deploymentInfo) => {
        let instance = instanceInfo.instance;
        let planInfo = instanceInfo.plan;
        let currentPlan = catalog.getPlan(planInfo.entity.unique_id);
        return {
          title: `${currentPlan.service.metadata.displayName || 'Service'} Dashboard`,
          plan: currentPlan,
          service: currentPlan.service,
          instance: _.set(instance, 'task', deploymentInfo),
          files: [{
            id: 'status',
            title: 'Status',
            language: 'yaml',
            content: yaml.dump(deploymentInfo)
          }]
        };
      });
  }

  scheduleBackUp() {
    const options = {
      instance_id: this.guid,
      repeatInterval: 'daily',
      type: CONST.BACKUP.TYPE.ONLINE
    };
    logger.debug(`Scheduling backup for  instance : ${this.guid}`);
    return Promise
      .try(() => {
        if (utils.isFeatureEnabled(CONST.FEATURE.SCHEDULED_BACKUP)) {
          try {
            this.manager.verifyFeatureSupport('backup');
            ScheduleManager
              .getSchedule(this.guid, CONST.JOB.SCHEDULED_BACKUP)
              .then(schedule => {
                logger.info(`Backup Job : ${schedule.name} already scheduled for instance : ${this.guid} with interval ${schedule.repeatInterval}`);
                return;
              })
              .catch((error) => {
                if (typeof error !== errors.NotFound) {
                  //NotFound is an expected error.
                  logger.warn('error occurred while fetching schedule for existing job', error);
                }
                if (this.service.backup_interval) {
                  options.repeatInterval = this.service.backup_interval;
                }
                logger.info(`Scheduling Backup for instance : ${this.guid} with backup interval of - ${options.repeatInterval}`);
                //Even if there is an error while fetching backup schedule, trigger backup schedule we would want audit log captured and riemann alert sent
                return this.serviceFabrikClient.scheduleBackup(options);
              });
          } catch (err) {
            logger.error(`Error occurred while scheduling backup for instance: ${this.guid}. More info:`, err);
          }
        } else {
          logger.info('Scheduled Backup feature not enabled');
        }
      });
  }

  scheduleAutoUpdate() {
    const options = {
      instance_id: this.guid,
      repeatInterval: CONST.SCHEDULE.RANDOM,
      timeZone: _.get(config, 'scheduler.jobs.service_instance_update.time_zone', 'UTC')
    };
    return utils
      .retry(tries => {
        logger.info(`+-> ${CONST.ORDINALS[tries]} attempt to schedule auto update for : ${this.guid}`);
        if (utils.isFeatureEnabled(CONST.FEATURE.SCHEDULED_UPDATE)) {
          return this
            .serviceFabrikClient
            .scheduleUpdate(options)
            .catch(err => {
              logger.error(`Error occurred while setting up auto update for : ${this.guid}`, err);
              throw err;
            });
        } else {
          logger.warn(` Schedule update feature is disabled. Auto update not scheduled for instance : ${this.guid}`);
        }
      }, {
        maxAttempts: 3,
        minDelay: 1000
      })
      .catch(err => logger.error(`Error occurred while scheduling auto-update for instance: ${this.guid} - `, err));
  }
}

module.exports = DirectorInstance;