'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
var moment = require('moment-timezone');
const catalog = require('../common/models/catalog');
const errors = require('../common/errors');
const logger = require('../common/logger');
const config = require('../common/config');
const NetworkSegmentIndex = require('../data-access-layer/bosh/NetworkSegmentIndex');
const backupStore = require('../data-access-layer/iaas').backupStore;
const FabrikBaseController = require('./FabrikBaseController');
const utils = require('../common/utils');
const fabrik = require('../broker/lib/fabrik');
const bosh = require('../data-access-layer/bosh');
const ScheduleManager = require('../jobs');
const BackupReportManager = require('../reports');
const CONST = require('../common/constants');
const maintenanceManager = require('../maintenance').maintenanceManager;
const serviceBrokerClient = require('../common/utils/ServiceBrokerClient');
const eventmesh = require('../data-access-layer/eventmesh');
const DirectorService = require('../managers/bosh-manager/DirectorService');
const Conflict = errors.Conflict;
const Forbidden = errors.Forbidden;
const BadRequest = errors.BadRequest;

class ServiceFabrikAdminController extends FabrikBaseController {
  constructor() {
    super();
  }

  updateDeployment(req, res) {
    const redirect_uri = _.get(req.query, 'redirect_uri', '/admin/deployments/outdated');
    const allowForbiddenManifestChanges = (req.body.forbidden_changes === undefined) ? true :
      JSON.parse(req.body.forbidden_changes);
    const deploymentName = req.params.name;
    const instanceId = this.parseServiceInstanceIdFromDeployment(deploymentName);
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
            'service-fabrik-operation': true
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
      return eventmesh.apiServerClient.getResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: instanceId
        })
        .catch(errors.NotFound, () => undefined)
        .then(resource => _.get(resource, 'spec.options'))
        .then(resource => {
          resourceDetails = resource;
          if (resourceDetails === undefined) {
            throw new errors.NotFound(`Resource details of service instance ${instanceId} not found in api server.`);
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
                .then(diff => utils.hasChangesInForbiddenSections(diff))
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

  updateOutdatedDeployments(req, res) {
    const self = this;

    function updateDeployment(deployment) {
      return Promise
        .try(() => {
          utils.hasChangesInForbiddenSections(deployment.diff);
        })
        .then(() => self.fabrik
          .createOperation('update', {
            deployment: deployment.name,
            username: req.user.name,
            arguments: req.body
          })
          .invoke()
        )
        .then(result => ({
          deployment: deployment.name,
          guid: result.guid
        }))
        .catch(Forbidden, Conflict, err => ({
          deployment: deployment.name,
          error: _.pick(err, 'status', 'message')
        }));
    }

    return this
      .findOutdatedDeployments()
      .map(updateDeployment)
      .then(body => res
        .status(202)
        .send(body)
      );
  }

  parseServiceInstanceIdFromDeployment(deploymentName) {
    const deploymentNameArray = utils.deploymentNameRegExp().exec(deploymentName);
    if (deploymentNameArray !== undefined && deploymentNameArray.length === 4) {
      return deploymentNameArray[3];
    }
    return deploymentName;
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

  getDeployments(req, res, onlySummary) {
    function assignOrgAndSpace(deployments, organizations, spaces) {
      spaces = _
        .chain(spaces)
        .map(resource => {
          const entity = resource.entity;
          entity.guid = resource.metadata.guid;
          return entity;
        })
        .keyBy('guid')
        .value();
      organizations = _
        .chain(organizations)
        .map(resource => {
          const entity = resource.entity;
          entity.guid = resource.metadata.guid;
          return entity;
        })
        .keyBy('guid')
        .value();
      _.each(deployments, deployment => {
        if (_.isObject(deployment.metadata)) {
          deployment.entity.guid = deployment.metadata.guid;
          deployment.space = spaces[deployment.entity.space_guid];
          deployment.organization = organizations[deployment.space.organization_guid];
        }
      });
      return deployments;
    }

    return Promise
      .all([
        this.findAllDeployments(),
        this.cloudController.getOrganizations(),
        this.cloudController.getSpaces()
      ])
      .spread(assignOrgAndSpace)
      .map(deployment => {
        if (deployment.manager) {
          const networkSegmentIndex = deployment.manager.getNetworkSegmentIndex(deployment.name);
          const plan = deployment.manager.plan;
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
    this.getDeployments(req, res, true);
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
    this.createManager(req.query.plan_id)
      .then(manager => this.cloudController.getOrgAndSpaceGuid(this.getInstanceId(deploymentName))
        .then(opts => {
          const context = {
            platform: CONST.PLATFORM.CF,
            organization_guid: opts.organization_guid,
            space_guid: opts.space_guid
          };
          opts.context = context;
          return Promise
            .all([
              this.director.getDeploymentVmsVitals(deploymentName),
              this.director.getTasks({
                deployment: deploymentName
              }),
              manager.diffManifest(deploymentName, opts).then(utils.unifyDiffResult)
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
        .set('diff', utils.unifyDiffResult(deployment))
        .set('instance', _
          .chain(deployment.entity)
          .pick('name', 'last_operation', 'space_guid', 'service_plan_id', 'service_plan_guid', 'dashboard_url')
          .set('guid', deployment.metadata.guid)
          .value()
        )
        .value();
    }

    return this
      .findOutdatedDeployments()
      .then(deployments => {
        const locals = {
          deployments: _.map(deployments, mapDeployment)
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

  findAllDeployments() {
    return Promise
      .all([
        this.getServiceFabrikDeployments(),
        this.getServiceInstancesForServiceBroker(this.serviceBrokerName)
      ])
      .spread((deployments, instances) => _
        .chain(_.keyBy(deployments, 'guid'))
        .merge(_.keyBy(instances, 'metadata.guid')) // deep merge
        .values()
        .value()
      );
  }

  findOutdatedDeployments() {
    logger.info('Searching for outdated deployments...');
    return this
      .findAllDeployments()
      .filter(deployment => {
        if (!deployment.name) {
          logger.warn(`Found service instance '${deployment.entity.name} [${deployment.metadata.guid}]' without deployment`);
          return false;
        }
        if (!deployment.manager) {
          logger.warn(`Found deployment '${deployment.name}' without service instance`);
          return false;
        }
        return this.cloudController.getOrgAndSpaceGuid(this.getInstanceId(deployment.name))
          .then(opts => {
            const context = {
              platform: CONST.PLATFORM.CF,
              organization_guid: opts.organization_guid,
              space_guid: opts.space_guid
            };
            opts.context = context;
            return deployment.manager
              .diffManifest(deployment.name, opts)
              .then(result => _
                .chain(deployment)
                .assign(_.pick(result, 'diff', 'manifest'))
                .get('diff')
                .size()
                .gt(0)
                .value()
              );
          });
      })
      .tap(deployments =>
        logger.info('Found outdated deployments', _.map(deployments, 'name'))
      );
  }

  getServiceFabrikDeployments() {
    const DirectorManager = this.fabrik.DirectorManager;

    function extractGuidFromName(deployment) {
      return (deployment.guid = _.nth(DirectorManager.parseDeploymentName(deployment.name), 2));
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
            return this
              .createManager(plan.id)
              .then(manager => _
                .chain(instance)
                .set('manager', manager)
                .set('entity.service_plan_id', plan.id)
                .value()
              );
          });
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
        logger.error('Error occurred while fetching list of Backup List file info');
        logger.error(err);
        throw err;
      })
      .catchThrow(RangeError, new BadRequest('Parameter \'before\' is not a valid Date'));
  }

  provisionDataBase(req, res) {
    return this.fabrik.dbManager
      .createOrUpdateDbDeployment(true)
      .then(() => res.status(202).send(this.fabrik.dbManager.getState()))
      .catch(err => {
        logger.error('Error occurred while provisioning service-fabrik db. More info:', err);
        throw err;
      });
  }

  updateDatabaseDeployment(req, res) {
    return this.fabrik.dbManager
      .createOrUpdateDbDeployment(false)
      .then(() => res.status(202).send(this.fabrik.dbManager.getState()))
      .catch(err => {
        logger.error('Error occurred while provisioning service-fabrik db. More info:', err);
        throw err;
      });
  }

  getDatabaseInfo(req, res) {
    return res.status(200).send(this.fabrik.dbManager.getState());
  }

  startOobBackup(req, res) {
    const opts = {
      user: req.user,
      deploymentName: req.params.name,
      arguments: _.omit(req.body, 'bosh_director')
    };
    logger.info(`Starting OOB backup for: ${opts.deploymentName}`);
    const oobBackupManager = fabrik.oobBackupManager.getInstance(req.body.bosh_director);
    let body;
    return oobBackupManager
      .startBackup(opts)
      .then(result => {
        body = _.pick(result, 'operation', 'backup_guid');
        body.token = utils.encodeBase64(result);
        return registerOperationCompletionStatusPoller(req.params.name, 'backup', body,
          new Date().toISOString(), req.body.bosh_director);
      })
      .then(() => res.status(202)
        .send(body));
  }

  getOobBackup(req, res) {
    const oobBackupManager = fabrik.oobBackupManager.getInstance(req.query.bosh_director);
    return oobBackupManager
      .getBackup(req.params.name, req.query.backup_guid)
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
      throw new errors.BadRequest('Query param token is required');
    }
    const options = utils.decodeBase64(req.query.token);
    options.deploymentName = req.params.name;
    if (_.isEmpty(options.agent_ip)) {
      throw new errors.BadRequest('Invalid token input');
    }
    const oobBackupManager = fabrik.oobBackupManager.getInstance(req.query.bosh_director);
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
          deploymentName: req.params.name
        };

        if (!opts.backup_guid) {
          throw new BadRequest('Invalid input as backup_guid or time_stamp not present');
        } else if (opts.backup_guid) {
          this.validateUuid(opts.backup_guid, 'Backup GUID');
        }

        logger.info(`Starting OOB restore for: ${opts.deploymentName}`);
        const oobBackupManager = fabrik.oobBackupManager.getInstance(req.body.bosh_director);
        let body;
        return oobBackupManager
          .startRestore(opts)
          .then(result => {
            body = _.pick(result, 'operation', 'backup_guid');
            body.token = utils.encodeBase64(result);
            return registerOperationCompletionStatusPoller(req.params.name, 'restore', body,
              new Date().toISOString(), req.body.bosh_director);
          })
          .then(() => res.status(202)
            .send(body));
      });
  }

  getLastOobRestoreStatus(req, res) {
    if (_.isEmpty(req.query.token)) {
      throw new errors.BadRequest('Query param token is required');
    }
    const options = utils.decodeBase64(req.query.token);
    options.deploymentName = req.params.name;
    if (_.isEmpty(options.agent_ip)) {
      throw new errors.BadRequest('Invalid token input');
    }
    const oobBackupManager = fabrik.oobBackupManager.getInstance(req.query.bosh_director);
    return oobBackupManager
      .getLastRestoreStatus(options)
      .then(result => {
        res.status(200)
          .send(result);
      });
  }

  getOobRestore(req, res) {
    const oobBackupManager = fabrik.oobBackupManager.getInstance(req.query.bosh_director);
    return oobBackupManager
      .getRestore(req.params.name)
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
    return boshDirector.getAgentPropertiesFromManifest(req.params.name)
      .then((deploymentAgentProps) => {
        const deploymentAgentContainer = deploymentAgentProps.provider.container;
        if (_.isEmpty(deploymentAgentContainer)) {
          /*if the deployment is deleted, there won't be any clue where the backup was stored by agent.
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
          .value();

        return ScheduleManager.schedule(
            req.params.name,
            CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP,
            req.body.repeatInterval,
            data,
            req.user)
          .then(body => res
            .status(201)
            .send(body));
      });
  }

  getOobBackupSchedule(req, res) {
    return ScheduleManager
      .getSchedule(req.params.name, CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP)
      .then(body => res
        .status(200)
        .send(body));
  }

  cancelOobScheduledBackup(req, res) {
    return ScheduleManager
      .cancelSchedule(req.params.name, CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP)
      .then(() => res
        .status(200)
        .send({}));
  }

  // Method for backup reporting
  getServiceInstanceBackupSummary(req, res) {
    if (!req.params.instance_id || !req.query.start_time || !req.query.end_time) {
      throw new BadRequest('instance_id | start_time | end_time required');
    }
    if (!moment(req.query.start_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid start date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    if (!moment(req.query.end_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid end date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    const start_time = moment.utc(req.query.start_time).toDate();
    const end_time = moment.utc(req.query.end_time).endOf('day').toDate();
    return BackupReportManager
      .getInstanceBackupSummary(req.params.instance_id, start_time, end_time)
      .then(body => res
        .status(200)
        .send(body));
  }

  //Method for getting backup instance ids
  getScheduledBackupInstances(req, res) {
    if (req.query.start_time && !moment(req.query.start_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid start date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    if (req.query.end_time && !moment(req.query.end_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid end date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    const start_time = req.query.start_time ? moment.utc(req.query.start_time).toDate() : undefined;
    const end_time = req.query.end_time ? moment.utc(req.query.end_time).endOf('day').toDate() : undefined;
    return BackupReportManager
      .getInstancesWithBackupScheduled(start_time, end_time)
      .then(body => res
        .status(200)
        .send(body));
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
  operationResp, startedAt, boshDirectorName) {

  const data = {
    deployment_name: deploymentName,
    type: CONST.BACKUP.TYPE.ONLINE,
    operation_job_started_at: startedAt,
    trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
    operation: operationName,
    operation_response: operationResp,
    bosh_director: boshDirectorName
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