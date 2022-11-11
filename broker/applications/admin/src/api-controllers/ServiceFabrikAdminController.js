'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const { catalog } = require('@sf/models');
const {
  CONST,
  errors: {
    BadRequest,
    NotFound
  },
  commonFunctions: {
    parseServiceInstanceIdFromDeployment,
    hasChangesInForbiddenSections,
    unifyDiffResult,
    encodeBase64,
    decodeBase64,
    getCronAfterXMinuteFromNow
  },
  Repository
} = require('@sf/common-utils');
const logger = require('@sf/logger');
const config = require('@sf/app-config');
const { NetworkSegmentIndex } = require('@sf/bosh');
const { backupStore } = require('@sf/iaas');
const { cloudController } = require('@sf/cf');
const {
  FabrikBaseController
} = require('@sf/common-controllers');
const bosh = require('@sf/bosh');
const ScheduleManager = require('@sf/jobs');
const { maintenanceManager } = require('../../../scheduler/src/maintenance');
const { serviceBrokerClient } = require('@sf/broker-client');
const { apiServerClient } = require('@sf/eventmesh');
const dbManager = require('@sf/db').dbManager;
const OobBackupManager = require('@sf/oob-manager');
const DirectorService = require('@sf/provisioner-services').DirectorService;

class ServiceFabrikAdminController extends FabrikBaseController {
  constructor() {
    super();
    this.cloudController = cloudController;
    this.backupStore = backupStore;
    this.director = bosh.director;
  }

  getInstanceId(deploymentName) {
    return _.nth(DirectorService.parseDeploymentName(deploymentName), 2);
  }

  updateDeployment(req, res) {
    const redirect_uri = _.get(req.query, 'redirect_uri', '/admin/deployments/outdated');
    const allowForbiddenManifestChanges = (req.body.forbidden_changes === undefined) ? true :
      JSON.parse(req.body.forbidden_changes);
    const deploymentName = req.params.name;
    const instanceId = parseServiceInstanceIdFromDeployment(deploymentName);
    const runImmediately = (req.body.run_immediately === 'true' ? true : false);
    let resourceDetails;
    let plan;
    let context;

    function updateDeployment() {
      return serviceBrokerClient
        .updateServiceInstance({
          instance_id: instanceId,
          context: context,
          service_id: plan.service.id,
          plan_id: plan.id,
          previous_values: {
            service_id: plan.service.id,
            plan_id: plan.id,
            organization_id: context.organization_id,
            space_id: context.space_guid
          },
          parameters: {
            _runImmediately: runImmediately || false,
            'service-fabrik-operation': true,
            // Adding this key to make every patch call unique
            // inorder to make interoperator react on spec change
            'service-fabrik-operation-timestamp': new Date(Date.now()).toISOString()
          }
        })
        .then(body => {
          res.format({
            html: () => res
              .redirect(303, redirect_uri),
            default: () => res
              .status(200)
              .send(body)
          });
        });
    }

    return Promise.try(() => {
      logger.info(`Forbidden Manifest flag set to ${allowForbiddenManifestChanges}`);
      /* TODO: Conditional statement to fetch resource options below is needed to be backwards compatible 
       as appliedOptions was added afterwards. Should be removed once all the older resources are updated. */
      return apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: instanceId
      })
        .catch(NotFound, () => undefined)
        .then(resource => _.get(resource, 'status.appliedOptions') ? _.get(resource, 'status.appliedOptions') : _.get(resource, 'spec.options'))
        .then(resource => {
          resourceDetails = resource;
          if (resourceDetails === undefined) {
            throw new NotFound(`Resource details of service instance ${instanceId} not found in api server.`);
          } else {
            const planId = _.get(resourceDetails, 'plan_id');
            plan = catalog.getPlan(planId);
            context = _.get(resourceDetails, 'context');
            if (allowForbiddenManifestChanges === false) {
              const tenantInfo = _.pick(resourceDetails, ['context']);
              return this
                .getOutdatedDiff({
                  instance_id: instanceId,
                  deployment_name: deploymentName
                }, tenantInfo, plan)
                .then(diff => hasChangesInForbiddenSections(diff))
                .tap(() => logger.info(`Doing update for ${deploymentName} as there is no forbidden changes in manifest`))
                .then(() => updateDeployment());
            } else {
              logger.info(`Doing update for ${deploymentName} even if forbidden changes exist in manifest`);
              return updateDeployment();
            }
          }
        });
    });
  }

  getOutdatedDiff(instanceDetails, tenantInfo, plan) {
    const deploymentName = instanceDetails.deployment_name;
    logger.debug(`Getting outdated diff for  :  ${deploymentName}`);
    return DirectorService.createInstance(instanceDetails.instance_id, {
      plan_id: plan.id,
      context: tenantInfo.context
    })
      .then(directorInstance => directorInstance.diffManifest(deploymentName, tenantInfo))
      .tap(result => logger.debug(`Diff of manifest for ${deploymentName} is ${result.diff}`))
      .then(result => result.diff);
  }

  getDeployments(req, res, onlySummary, fetchFromApiServer) {
    function assignOrgAndSpace(deployments, organizations, spaces) {
      spaces = _
        .chain(spaces)
        .map(resource => {
          const entity = {
            guid: resource.guid,
            name: resource.name,
            organization_guid: resource.relationships.organization.data.guid
          };
          return entity;
        })
        .keyBy('guid')
        .value();
      organizations = _
        .chain(organizations)
        .map(resource => {
          const entity = {
            guid: resource.guid,
            name: resource.name,
            quota_definition_guid: resource.relationships.quota.data.guid
          };
          return entity;
        })
        .keyBy('guid')
        .value();
      _.each(deployments, deployment => {
        if (_.isObject(deployment.metadata)) {
          deployment.entity.guid = _.get(deployment, 'metadata.guid');
          deployment.space = spaces[_.get(deployment, 'entity.space_guid')];
          deployment.organization = organizations[_.get(deployment, 'space.organization_guid')];
        }
      });
      
      return deployments;
    }

    return Promise
      .all([
        this.findAllDeployments(fetchFromApiServer),
        this.cloudController.getOrganizations(),
        this.cloudController.getSpaces()
      ])
      .spread(assignOrgAndSpace)
      .map(deployment => {
        if (deployment.directorService) {
          const networkSegmentIndex = deployment.directorService.getNetworkSegmentIndex(deployment.name);
          const plan = deployment.directorService.plan;
          const service = _.omit(plan.service, 'plans');
          deployment = _
            .chain(deployment)
            .pick('guid', 'name', 'stemcells', 'releases', 'entity', 'space', 'organization', 'vms')
            .set('plan', plan)
            .set('service', service)
            .set('index', NetworkSegmentIndex.adjust(networkSegmentIndex))
            .value();
        }
        if (!onlySummary) {
          if (deployment.name) {
            return this.director
              .getDeploymentVms(deployment.name)
              .then(vms => (deployment.vms = vms))
              .return(deployment);
          }
        }
        return deployment;
      })
      .then(deployments => {
        const locals = {
          deployments: deployments
        };
        res.format({
          html: () => res
            .status(200)
            .render('director-instances', locals),
          default: () => res
            .status(200)
            .send(locals)
        });
      });
  }

  getDeploymentsSummary(req, res) {
    this.getDeployments(req, res, true, true);
  }

  getDeploymentDirectorConfig(req, res) {
    const deploymentName = req.params.name;
    return bosh.director
      .getDirectorConfig(deploymentName)
      .then(config => res
        .status(200)
        .send(config)
      );
  }

  getDeployment(req, res) {
    const deploymentName = req.params.name;
    const plan = catalog.getPlan(req.query.plan_id);
    Promise.try(() => DirectorService.createInstance(this.getInstanceId(deploymentName), {
      plan_id: plan.id
    }))
      .then(directorService =>
        apiServerClient.getPlatformContext({
          resourceGroup: plan.resourceGroup,
          resourceType: plan.resourceType,
          resourceId: this.getInstanceId(deploymentName)
        })
          .then(context => {
            const opts = {};
            opts.context = context;
            return Promise
              .all([
                this.director.getDeploymentVmsVitals(deploymentName),
                this.director.getTasks({
                  deployment: deploymentName
                }),
                directorService.diffManifest(deploymentName, opts).then(unifyDiffResult)
              ])
              .spread((vms, tasks, diff) => ({
                name: deploymentName,
                diff: diff,
                tasks: _.filter(tasks, task => !_.startsWith(task.description, 'snapshot')),
                vms: _.filter(vms, vm => !_.isNil(vm.vitals))
              }));
          })
      )
      .then(locals => {
        res.format({
          html: () => res
            .status(200)
            .render('director-instance', locals),
          default: () => res
            .status(200)
            .send(locals)
        });
      });
  }

  getOutdatedDeployments(req, res) {
    function mapDeployment(deployment) {
      return _
        .chain(deployment)
        .pick('name', 'releases', 'stemcell')
        .set('diff', unifyDiffResult(deployment, true))
        .set('instance', _
          .chain(deployment.entity)
          .pick('name', 'last_operation', 'space_guid', 'service_plan_id', 'service_plan_guid', 'dashboard_url')
          .set('guid', deployment.metadata.guid)
          .value()
        )
        .value();
    }
    const serviceBrokerName = _.get(req.query, 'service_broker', this.serviceBrokerName);
    return this
      .findOutdatedDeployments(serviceBrokerName)
      .then(deployments => {
        const mappedDeployments = _.map(deployments, mapDeployment);
        const locals = {
          deployments: _.filter(mappedDeployments, deployment => {
            return !_.isEmpty(deployment.diff);
          })
        };
        res.format({
          html: () => res
            .status(200)
            .render('deployments', _.assign(locals, {
              catalog: catalog
            })),
          default: () => res
            .status(200)
            .send(locals)
        });
      });
  }

  deleteBackup(req, res) {
    const redirect_uri = _.get(req.query, 'redirect_uri', '/admin/backups');
    const options = _
      .chain(req.params)
      .pick('backup_guid')
      .assign(_.omit(req.body, 'space_guid'))
      .set('user', req.user)
      .value();
    options.tenant_id = req.body.space_guid;
    return this.backupStore
      .deleteBackupFile(options)
      .then(() => {
        const locals = {};
        res.format({
          html: () => res
            .redirect(303, redirect_uri),
          default: () => res
            .status(200)
            .send(locals)
        });
      });
  }

  findAllDeployments(fetchFromApiServer, serviceBrokerName = this.serviceBrokerName) {
    return Promise
      .all([
        this.getServiceFabrikDeployments(),
        Promise.try(() => {
          if (fetchFromApiServer) {
            return this.getServiceInstancesFromApiServer();
          } else {
            return this.getServiceInstancesForServiceBroker(serviceBrokerName);
          }
        })
      ])
      .spread((deployments, instances) => _
        .chain(_.keyBy(deployments, 'guid'))
        .merge(_.keyBy(instances, 'metadata.guid')) // deep merge
        .values()
        .value()
      );
  }

  findOutdatedDeployments(serviceBrokerName) {
    logger.info(`Searching for outdated deployments using broker ${serviceBrokerName}...`);
    return this
      .findAllDeployments(false, serviceBrokerName)
      .filter(deployment => {
        if (!deployment.name) {
          logger.warn(`Found service instance '${deployment.entity.name} [${deployment.metadata.guid}]' without deployment`);
          return false;
        }
        if (!deployment.directorService) {
          logger.warn(`Found deployment '${deployment.name}' without service instance`);
          return false;
        }
        const opts = {};
        opts.context = {
          platform: 'cloudfoundry'
        };
        return deployment.directorService
          .diffManifest(deployment.name, opts)
          .then(result => _
            .chain(deployment)
            .assign(_.pick(result, 'diff', 'manifest'))
            .get('diff')
            .size()
            .gt(0)
            .value()
          );
      })
      .tap(deployments =>
        logger.info('Found outdated deployments', _.map(deployments, 'name'))
      );
  }

  getServiceFabrikDeployments() {

    function extractGuidFromName(deployment) {
      return (deployment.guid = _.nth(DirectorService.parseDeploymentName(deployment.name), 2));
    }

    return this.director
      .getDeployments()
      .filter(deployment => !_.isNil(extractGuidFromName(deployment)))
      .map(deployment => _.pick(deployment, 'guid', 'name', 'stemcells', 'releases'))
      .tap(deployments => logger.debug(deployments));
  }

  getServiceInstancesForServiceBroker(name) {
    return this.cloudController
      .findServiceBrokerByName(name)
      .then(serviceBroker => this.cloudController
        .getServicePlans(`service_broker_guid:${serviceBroker.metadata.guid}`)
      )
      .then(plans => {
        const guids = _
          .chain(plans)
          .filter(plan => catalog.getPlan(plan.entity.unique_id).manager.name === CONST.INSTANCE_TYPE.DIRECTOR)
          .map(plan => plan.metadata.guid)
          .join(',')
          .value();
        return this.cloudController
          .getServiceInstances(`service_plan_guid IN ${guids}`)
          .map(instance => {
            const plan = getPlanByGuid(plans, instance.entity.service_plan_guid);
            return Promise.try(() => DirectorService.createInstance(_.get(instance, 'metadata.guid'), {
              plan_id: plan.id,
              context: {
                platform: CONST.PLATFORM.CF
              }
            }))
              .then(service => _
                .chain(instance)
                .set('directorService', service)
                .set('entity.service_plan_id', plan.id)
                .value()
              );
          });
      });
  }

  getServiceInstancesFromApiServer() {
    function filterFaultyResources(director) {
      if (!_.get(director, 'spec.options.context.space_guid') 
      || !_.get(director, 'spec.options.context.instance_name')
      || !_.get(director, 'spec.options.plan_id')) {
        logger.info(`Faulty director resource found in deployment summary: ${_.get(director, 'metadata.name')}`);
        return false;
      }
      return true;
    }
    return apiServerClient.getResourceListByState({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      stateList: [
        CONST.APISERVER.RESOURCE_STATE.SUCCEEDED, 
        CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS, 
        CONST.APISERVER.RESOURCE_STATE.FAILED
      ]
    })
      .then(directors => {
        directors = _
          .chain(directors)
          .filter(filterFaultyResources)
          .map(director => {
            const instance_guid = _.get(director, 'metadata.name');
            const space_guid = _.get(director, 'spec.options.context.space_guid');
            const instance_name = _.get(director, 'spec.options.context.instance_name');
            return _
              .chain(director)
              .set('metadata.guid', instance_guid)
              .set('entity.space_guid', space_guid)
              .set('entity.name', instance_name)
              .value();
          })
          .value();
        return directors;
      })
      .map(director => {
        const plan = catalog.getPlan(director.spec.options.plan_id);
        return Promise.try(() => DirectorService.createInstance(_.get(director, 'metadata.guid'), {
          plan_id: plan.id,
          context: {
            platform: CONST.PLATFORM.CF
          }
        }))
          .then(service => _
            .chain(director)
            .set('directorService', service)
            .set('entity.service_plan_id', plan.id)
            .value()
          );
      });
  }

  getListOfBackups(req, res) {
    const before = req.query.before;
    return backupStore
      .listBackupFilenames(before)
      .map(filenameObject => _.omit(filenameObject, 'name', 'operation'))
      .tap(backups => logger.debug(`List of backups before '${before}':`, backups))
      .then(backups => {
        const locals = {
          backups: backups
        };
        res.format({
          html: () => res
            .status(200)
            .render('backups', _.assign(locals, {
              url: req.originalUrl,
              catalog: catalog
            })),
          default: () => res
            .status(200)
            .send(locals)
        });
      })
      .catch(err => {
        logger.error('Error occurred while fetching list of Backup List file info', err);
        throw err;
      })
      .catchThrow(RangeError, new BadRequest('Parameter \'before\' is not a valid Date'));
  }

  provisionDataBase(req, res) {
    return dbManager
      .createOrUpdateDbDeployment(true)
      .then(() => res.status(202).send(dbManager.getState()))
      .catch(err => {
        logger.error('Error occurred while provisioning service-fabrik db. More info:', err);
        throw err;
      });
  }

  updateDatabaseDeployment(req, res) {
    return dbManager
      .createOrUpdateDbDeployment(false)
      .then(() => res.status(202).send(dbManager.getState()))
      .catch(err => {
        logger.error('Error occurred while provisioning service-fabrik db. More info:', err);
        throw err;
      });
  }

  getDatabaseInfo(req, res) {
    return res.status(200).send(dbManager.getState());
  }

  startOobBackup(req, res) {
    const opts = {
      user: req.user,
      deploymentName: req.params.name,
      arguments: _.omit(req.body, 'bosh_director'),
      agent_properties: req.body.agent_properties
    };
    logger.info(`Starting OOB backup for: ${opts.deploymentName}`);
    const oobBackupManager = OobBackupManager.getInstance(req.body.bosh_director);
    let body;
    return oobBackupManager
      .startBackup(opts)
      .then(result => {
        body = _.pick(result, 'operation', 'backup_guid');
        body.token = encodeBase64(result);
        return registerOperationCompletionStatusPoller(req.params.name, 'backup', body,
          new Date().toISOString(), req.body.bosh_director, req.body.agent_properties);
      })
      .then(() => res.status(202)
        .send(body));
  }

  getOobBackup(req, res) {
    const oobBackupManager = OobBackupManager.getInstance(req.query.bosh_director);
    return oobBackupManager
      .getBackup(req.params.name, req.query.backup_guid, req.body.agent_properties)
      .map(data => _.omit(data, 'secret', 'agent_ip', 'logs', 'container'))
      .then(backups => {
        const locals = {
          backups: backups
        };
        res.status(200)
          .send(locals);
      });
  }

  getLastOobBackupStatus(req, res) {
    if (_.isEmpty(req.query.token)) {
      throw new BadRequest('Query param token is required');
    }
    const options = decodeBase64(req.query.token);
    options.deploymentName = req.params.name;
    options.agent_properties = req.body.agent_properties;
    if (_.isEmpty(options.agent_ip)) {
      throw new BadRequest('Invalid token input');
    }
    const oobBackupManager = OobBackupManager.getInstance(req.query.bosh_director);
    return oobBackupManager
      .getLastBackupStatus(options)
      .then(result => {
        res.status(200)
          .send(result);
      });
  }

  startOobRestore(req, res) {
    return Promise
      .try(() => {
        const opts = {
          user: req.user,
          backup_guid: req.body.backup_guid,
          deploymentName: req.params.name,
          agent_properties: req.body.agent_properties
        };

        if (!opts.backup_guid) {
          throw new BadRequest('Invalid input as backup_guid or time_stamp not present');
        } else if (opts.backup_guid) {
          this.validateUuid(opts.backup_guid, 'Backup GUID');
        }

        logger.info(`Starting OOB restore for: ${opts.deploymentName}`);
        const oobBackupManager = OobBackupManager.getInstance(req.body.bosh_director);
        let body;
        return oobBackupManager
          .startRestore(opts)
          .then(result => {
            body = _.pick(result, 'operation', 'backup_guid');
            body.token = encodeBase64(result);
            return registerOperationCompletionStatusPoller(req.params.name, 'restore', body,
              new Date().toISOString(), req.body.bosh_director, req.body.agent_properties);
          })
          .then(() => res.status(202)
            .send(body));
      });
  }

  getLastOobRestoreStatus(req, res) {
    if (_.isEmpty(req.query.token)) {
      throw new BadRequest('Query param token is required');
    }
    const options = decodeBase64(req.query.token);
    options.deploymentName = req.params.name;
    options.agent_properties = req.body.agent_properties;
    if (_.isEmpty(options.agent_ip)) {
      throw new BadRequest('Invalid token input');
    }
    const oobBackupManager = OobBackupManager.getInstance(req.query.bosh_director);
    return oobBackupManager
      .getLastRestoreStatus(options)
      .then(result => {
        res.status(200)
          .send(result);
      });
  }

  getOobRestore(req, res) {
    const oobBackupManager = OobBackupManager.getInstance(req.query.bosh_director);
    return oobBackupManager
      .getRestore(req.params.name, req.body.agent_properties)
      .then(restoreInfo => {
        const locals = {
          restore: _.omit(restoreInfo, 'secret', 'agent_ip')
        };
        res.status(200)
          .send(locals);
      });
  }

  scheduleOobBackup(req, res) {
    if (_.isEmpty(req.body.repeatInterval) || _.isEmpty(req.body.type)) {
      throw new BadRequest('repeatInterval | type are mandatory');
    }
    const boshDirectorName = req.body.bosh_director;
    const boshDirector = bosh.director;
    return Promise.try(() => {
      if(!req.body.agent_properties) {
        return boshDirector.getAgentPropertiesFromManifest(req.params.name);
      }
      return req.body.agent_properties;
    })
      .then(deploymentAgentProps => {
        const deploymentAgentContainer = _.get(deploymentAgentProps, 'provider.container');
        if (_.isEmpty(deploymentAgentContainer)) {
          /* if the deployment is deleted, there won't be any clue where the backup was stored by agent.
          This case is unlike service instance based backup where we had service id ,
          from that we can figure out the container/bucket name.
          But here we don't have that info. that's why container/bucket is required.*/
          throw new BadRequest(`Backup not supported by deployment ${req.params.name}.
                  Required attribute 'provider.container' missing in manifest`);
        }
        const data = _.chain(req.body)
          .omit('repeatInterval')
          .set('deployment_name', req.params.name)
          .set('trigger', CONST.BACKUP.TRIGGER.SCHEDULED)
          .set('container', deploymentAgentContainer)
          .set('bosh_director', boshDirectorName)
          .set('agent_properties', deploymentAgentProps)
          .value();

        return ScheduleManager.schedule(
          req.params.name,
          CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP,
          req.body.repeatInterval,
          data,
          req.user)
          .then(body => res
            .status(201)
            .send(_.omit(body, 'data.agent_properties.provider', 'data.agent_properties.password')));
      });
  }

  getOobBackupSchedule(req, res) {
    return ScheduleManager
      .getSchedule(req.params.name, CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP)
      .then(body => res
        .status(200)
        .send(_.omit(body, 'data.agent_properties.provider', 'data.agent_properties.password')));
  }

  cancelOobScheduledBackup(req, res) {
    return ScheduleManager
      .cancelSchedule(req.params.name, CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP)
      .then(() => res
        .status(200)
        .send({}));
  }

  startMaintenance(req, res) {
    logger.info('req.body=>', req.body);
    return maintenanceManager
      .getMaintenaceInfo()
      .then(body => {
        if (body === null) {
          return maintenanceManager
            .startMaintenace(req.body, req.user)
            .then(body => res
              .status(201)
              .send(body));
        } else {
          res
            .status(403)
            .send({
              errorMessage: 'System already in maintenance mode',
              maintenanceInfo: body
            });
        }
      });
  }

  updateMaintenance(req, res) {
    return maintenanceManager
      .getMaintenaceInfo()
      .then(body => {
        if (body !== null) {
          return maintenanceManager
            .updateMaintenace(req.body.progress, req.body.state, req.user)
            .then(body => res
              .status(200)
              .send(body));
        } else {
          res
            .status(403)
            .send({
              errorMessage: 'System not in maintenance mode'
            });
        }
      });
  }

  getMaintenance(req, res) {
    return maintenanceManager
      .getMaintenaceInfo()
      .then(body => {
        if (body === null) {
          res
            .status(404)
            .send({
              system_in_maintenance: false
            });
        } else {
          _.set(body, 'system_in_maintenance', true);
          res
            .status(200)
            .send(body);
        }
      });
  }

  getMaintenanceHistory(req, res) {
    return maintenanceManager
      .getMaintenaceHistory(req.query.offset, req.query.records, req.query.sortBy, req.query.sortOrder)
      .then(body => res
        .status(200)
        .send(body));
  }

  // Method for getting  instance ids with updates scheduled
  getScheduledUpdateInstances(req, res) {
    logger.info('Getting scheduled update instance list...');
    return this.getInstancesWithUpdateScheduled()
      .then(body => res
        .status(200)
        .send(body));
  }

  runNow(req, res) {
    logger.info(`Running job name: ${req.body.job_name}, job type ${req.params.job_type}`);
    const instance_guid = _.get(req.body, 'instance_guid');
    const jobData = instance_guid == undefined ? {} : {
      instance_guid: instance_guid
    };
    const interval = getCronAfterXMinuteFromNow(1);
    return ScheduleManager
      .runAt(req.body.job_name, req.params.job_type, interval, jobData, req.user)
      .then(body => res.status(CONST.HTTP_STATUS_CODE.CREATED).send(body));
  }

  createUpdateConfig(req, res) {
    assert.ok(req.query.key, 'Key parameter must be defined for the Create Config request');
    assert.ok(req.query.value, 'Value parameter must be defined for the Create Config request');
    logger.info(`Creating config with key: ${req.query.key} and value: ${req.query.value}`);
    const config = {
      key: req.query.key,
      value: req.query.value
    };
    const body = {
      message: `Created/Updated ${req.query.key} with value ${req.query.value}`
    };
    return apiServerClient.createUpdateConfigMapResource(CONST.CONFIG.RESOURCE_NAME, config)
      .then(() => {
        return res.status(201).send(body);
      });
  }

  getConfig(req, res) {
    assert.ok(req.params.name, 'Key parameter must be defined for the Get Config request');
    return apiServerClient.getConfigMap(CONST.CONFIG.RESOURCE_NAME, req.params.name)
      .tap(value => logger.debug(`Returning config with key: ${req.params.name} and value: ${value}`))
      .then(value => {
        const body = {
          value: value,
          key: req.params.name
        };
        return res.status(200).send(body);
      });
  }

  getInstancesWithUpdateScheduled() {
    function getInstancesWithUpdateScheduled(instanceList, offset, modelName, searchCriteria, paginateOpts) {
      if (offset < 0) {
        return Promise.resolve();
      }
      _.chain(paginateOpts)
        .set('offset', offset)
        .value();
      return Repository.search(modelName, searchCriteria, paginateOpts)
        .then(result => {
          instanceList.push.apply(instanceList, _.map(result.list, 'data'));
          return getInstancesWithUpdateScheduled(instanceList, result.nextOffset, modelName, searchCriteria, paginateOpts);
        });
    }
    const criteria = {
      searchBy: {
        type: CONST.JOB.SERVICE_INSTANCE_UPDATE
      },
      projection: {
        'data.instance_id': 1
      }
    };
    const paginateOpts = {
      records: config.mongodb.record_max_fetch_count,
      offset: 0
    };
    const result = [];
    return getInstancesWithUpdateScheduled(result, 0, CONST.DB_MODEL.JOB, criteria, paginateOpts)
      .then(() => result);
  }
}

module.exports = ServiceFabrikAdminController;

/* Helper functions */

function getPlanByGuid(plans, guid) {
  const planId = _
    .chain(plans)
    .find(plan => (plan.metadata.guid === guid))
    .get('entity.unique_id')
    .value();
  return catalog.getPlan(planId);
}

function registerOperationCompletionStatusPoller(deploymentName, operationName,
  operationResp, startedAt, boshDirectorName, agentProperties) {

  const data = {
    deployment_name: deploymentName,
    type: CONST.BACKUP.TYPE.ONLINE,
    operation_job_started_at: startedAt,
    trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
    operation: operationName,
    operation_response: operationResp,
    bosh_director: boshDirectorName,
    agent_properties: agentProperties
  };

  // Repeat interval inminute
  const checkStatusInEveryThisMinute = config.backup.backup_restore_status_check_every / 60000;
  logger.debug(`Scheduling deployment ${deploymentName} ${operationName} for backup guid ${operationResp.backup_guid}
          ${CONST.JOB.OPERATION_STATUS_POLLER} for every ${checkStatusInEveryThisMinute}`);
  const repeatInterval = `*/${checkStatusInEveryThisMinute} * * * *`;
  return ScheduleManager
    .schedule(
      `${deploymentName}_${operationName}_${operationResp.backup_guid}`,
      CONST.JOB.OPERATION_STATUS_POLLER,
      repeatInterval,
      data, {
        name: config.cf.username
      }
    );
}
