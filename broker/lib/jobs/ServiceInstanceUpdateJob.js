'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../logger');
const config = require('../config');
const BaseJob = require('./BaseJob');
const errors = require('../errors');
const utils = require('../utils');
const cloudController = require('../cf').cloudController;
const Fabrik = require('../fabrik');
const catalog = require('../models/catalog');
const CONST = require('../constants');
const ScheduleManager = require('./ScheduleManager');
const Repository = require('../../../common/db').Repository;
//NOTE: Cyclic dependency withe above. (Taken care in JobFabrik)

class ServiceInstanceUpdateJob extends BaseJob {

  static run(job, done) {
    return Promise.try(() => {
      const instanceDetails = _.get(job.attrs, 'data');
      const jobName = _.get(job, `attrs.data.${CONST.JOB_NAME_ATTRIB}`);
      logger.info(`Starting Instance Update Job: ${jobName} - Instance name: ${instanceDetails.instance_name} - Deployment: ${instanceDetails.deployment_name}`);
      const operationResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: 'TBD',
        update_init: 'TBD',
        diff: 'TBD'
      };
      if (!_.get(instanceDetails, 'instance_id') || !_.get(instanceDetails, 'deployment_name')) {
        const msg = `ServiceInstance Update cannot be initiated as the required mandatory params (instance_id | deployment_name) is empty : ${JSON.stringify(instanceDetails)}`;
        logger.error(msg);
        return this.runFailed(new errors.BadRequest(msg), operationResponse, job, done);
      }
      if (!_.get(config, 'feature.ServiceInstanceAutoUpdate', false)) {
        const msg = `Schedule update feature is turned off. Cannot run update for ${instanceDetails.instance_name} - Deployment: ${instanceDetails.deployment_name}`;
        logger.error(msg);
        return this.runFailed(new errors.ServiceUnavailable(msg), operationResponse, job, done);
      }
      return this
        .getServicePlanIdForInstanceId(instanceDetails.instance_id)
        .then((planId) => (planId === undefined ?
          this.handleInstanceDeletion(instanceDetails, operationResponse, done) :
          this.updateInstanceIfOutdated(instanceDetails, planId, operationResponse)))
        .then(opResponse => this.runSucceeded(opResponse, job, done))
        .catch((error) => {
          this.runFailed(error, operationResponse, job, done);
        });
    });
  }

  static getServicePlanIdForInstanceId(instanceId) {
    return cloudController
      .findServicePlanByInstanceId(instanceId)
      .then(body => body.entity.unique_id)
      .catch(errors.ServiceInstanceNotFound, () => undefined);
  }

  static handleInstanceDeletion(instanceDetails, operationResponse) {
    logger.warn(`Instance Id: ${instanceDetails.instance_id} Name: ${instanceDetails.instance_name} is deleted. Cancelling Auto-Update Job`);
    return ScheduleManager
      .cancelSchedule(instanceDetails.instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE)
      .then(() => {
        logger.info(`Service Instance Auto-Update Job for : ${instanceDetails.instance_id} is cancelled`);
        operationResponse.job_cancelled = true;
        operationResponse.instance_deleted = true;
        return operationResponse;
      });
  }

  static updateInstanceIfOutdated(instanceDetails, planId, operationResponse) {
    const plan = catalog.getPlan(planId);
    logger.info(`Instance Id: ${instanceDetails.instance_id} - manager : ${plan.manager.name} - Force Update: ${plan.service.force_update}`);
    return this
      .getOutdatedDiff(instanceDetails.deployment_name, instanceDetails.instance_id, plan)
      .then(diffResults => {
        const outdated = _.get(diffResults, 'diff', false) && diffResults.diff.length !== 0;
        operationResponse.deployment_outdated = outdated;
        operationResponse.diff = utils.unifyDiffResult(diffResults);
        if (!outdated) {
          operationResponse.update_init = 'NA';
          logger.info(`Instance: ${instanceDetails.instance_name} - Deployment: ${instanceDetails.deployment_name} up-to date. No update required.`);
          return operationResponse;
        }
        let trackAttempts = true;
        return this
          .updateDeployment(
            instanceDetails.deployment_name,
            diffResults.diff,
            plan.service.force_update,
            instanceDetails.run_immediately
          )
          .then(result => {
            operationResponse.update_init = CONST.OPERATION.SUCCEEDED;
            operationResponse.update_operation_guid = result.guid;
            return operationResponse;
          })
          .catch(err => {
            operationResponse.update_init = CONST.OPERATION.FAILED;
            logger.error('Error occurred while updating service instance job :', err);
            if (err instanceof errors.DeploymentAttemptRejected) {
              //If deployment was staggered due to exhaustion of workers, reschedule update job
              //Retry attempts do not count when deployment is staggered
              //TODO: Need to check if the next run for scheduled update causes problems if the earlier deployment did not go through
              trackAttempts = false;
              err.statusMessage = 'Deployment attempt rejected due to BOSH overload. Update cannot be initiated';
            }
            if (err instanceof errors.DeploymentAlreadyLocked) {
              //If deployment locked then backup is in progress. So reschedule update job,
              //Retry attempts dont count when deployment is locked for backup.
              trackAttempts = false;
              err.statusMessage = 'Backup in-progress. Update cannot be initiated';
            }
            //Bubble error and make current run as a failure
            throw err;
          })
          .finally(() => {
            logger.info(`${instanceDetails.instance_name} instance update initiated. Status : `, operationResponse);
            //Even in case of successful initiation the job is rescheduled so that after the reschedule delay,
            //when this job comes up it must see itself as updated.
            //This is to handle any Infra errors that could happen post successful initiation of update. (its a retry mechanism)
            this
              .rescheduleUpdateJob(instanceDetails, trackAttempts);
          });
      });
  }

  static getOutdatedDiff(deploymentName, instanceId, plan) {
    return Fabrik
      .createManager(plan)
      .then((directorManager) => cloudController.getOrgAndSpaceGuid(instanceId)
        .then(opts => {
          const context = {
            platform: CONST.PLATFORM.CF,
            organization_guid: opts.organization_guid,
            space_guid: opts.space_guid
          };
          opts.context = context;
          return directorManager
            .diffManifest(deploymentName, opts);
        })
      );
  }

  static updateDeployment(deploymentName, diff, skipForbiddenCheck, runImmediately) {
    return Promise
      .try(() => {
        if (!skipForbiddenCheck) {
          utils.hasChangesInForbiddenSections(diff);
        }
      })
      .then(() => Fabrik
        .createOperation('update', {
          deployment: deploymentName,
          username: 'Auto_Update_Job',
          arguments: {},
          runImmediately: runImmediately || false
        })
        .invoke())
      .then(result => ({
        guid: result.guid
      }));
  }

  static rescheduleUpdateJob(instanceDetails, trackAttempts) {
    return Promise.try(() => {
      const jobData = _.cloneDeep(instanceDetails);
      jobData.attempt = jobData.attempt + 1;
      if (trackAttempts) {
        const MAX_ATTEMPTS = _.get(instanceDetails, 'max_attempts', config.scheduler.jobs.service_instance_update.max_attempts);
        if (jobData.attempt > MAX_ATTEMPTS) {
          logger.error(`Auto udpate for instance ${instanceDetails.instance_id}  has exceeded max configured attempts : ${MAX_ATTEMPTS}}`);
          return;
        }
      }
      const RUN_AFTER = _.get(instanceDetails, 'reschedule_delay', config.scheduler.jobs.reschedule_delay);
      logger.info(`Schedulding InstanceUpdate Job for ${instanceDetails.instance_name}:${instanceDetails.instance_id} @ ${RUN_AFTER} - Track : ${trackAttempts} - Attempt - ${instanceDetails.attempt}`);
      return ScheduleManager
        .runAt(instanceDetails.instance_id,
          CONST.JOB.SERVICE_INSTANCE_UPDATE,
          RUN_AFTER,
          jobData,
          CONST.SYSTEM_USER
        );
    });
  }

  static getRandomRepeatInterval() {
    const afterHr = _.get(config, 'scheduler.jobs.service_instance_update.should_start_after_hr', 0);
    const beforeHr = _.get(config, 'scheduler.jobs.service_instance_update.should_start_before_hr', 23);
    const afterMin = _.get(config, 'scheduler.jobs.service_instance_update.should_start_after_min', 0);
    const beforeMin = _.get(config, 'scheduler.jobs.service_instance_update.should_start_before_min', 59);
    const runOnceEvery = _.get(config, 'scheduler.jobs.service_instance_update.run_every_xdays', 15);
    const opts = {
      start_after_hr: afterHr,
      start_before_hr: beforeHr,
      start_after_min: afterMin,
      start_before_min: beforeMin
    };
    return utils.getRandomCronForOnceEveryXDays(runOnceEvery, opts);
  }

  static getLastRunStatus(name) {
    const sortOn = ['createdAt', 'desc'];
    const criteria = {
      sortBy: [sortOn],
      searchBy: {
        name: name,
        type: CONST.JOB.SERVICE_INSTANCE_UPDATE
      }
    };
    return Repository
      .search(CONST.DB_MODEL.JOB_RUN_DETAIL,
        criteria, {
          records: config.scheduler.jobs.service_instance_update.max_attempts,
          offset: 0
          //Fetch last 3 run history records and figure out the status of the update operation.
        })
      .then(lastRunDetails => {
        logger.info(`${name} - Total last runs # ${_.get(lastRunDetails, 'totalRecordCount', 0)}`);
        if (_.get(lastRunDetails, 'totalRecordCount', 0) === 0) {
          return null;
        }
        logger.info('LastRun details retrieved  # ', _.get(lastRunDetails, 'list', []).length);
        const lastRunList = lastRunDetails.list;
        const count = lastRunList.length;
        let initialJobRunStatus = lastRunList[count - 1];
        for (let idx = 0; idx < count; idx++) {
          if (lastRunList[idx].data.attempt === 1) {
            initialJobRunStatus = lastRunList[idx];
            break;
          }
        }
        logger.info('Initial run status - ', _.pick(initialJobRunStatus, 'data', 'response', 'statusCode', 'statusMessage', 'interval'));
        logger.info('Last run status - ', _.pick(lastRunList[0], 'data', 'response', 'statusCode', 'statusMessage', 'interval'));
        const diffBeforeUpdate = _.get(initialJobRunStatus, 'response.diff', null) || _.get(initialJobRunStatus, 'response.jobStatus.diff', null);
        const diffAfterUpdate = count === 1 ? 'TBD' : (_.get(lastRunList[0], 'response.diff') ||
          _.get(lastRunList[0], 'response.jobStatus.diff', null));
        const response = {
          lastRunAt: lastRunList[0].startedAt,
          diff: {
            before: diffBeforeUpdate,
            after: diffAfterUpdate
          }
        };
        if (lastRunList[0].statusCode === CONST.JOB_RUN_STATUS_CODE.SUCCEEDED) {
          return _.set(response, 'status', CONST.OPERATION.SUCCEEDED);
        } else {
          if (initialJobRunStatus.statusCode === CONST.JOB_RUN_STATUS_CODE.SUCCEEDED &&
            lastRunList[0].statusCode === CONST.HTTP_STATUS_CODE.CONFLICT) {
            //Initial run is success, but the next immediate run to try failed due to conflict
            //This means the initial job is still in-progress
            return _.set(response, 'status', CONST.OPERATION.IN_PROGRESS);
          } else if (initialJobRunStatus.statusCode === CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY) {
            _.set(response, 'message', 'Could not initiate update as Backup process was in-progress');
            return _.set(response, 'status', CONST.OPERATION.FAILED);
          } else {
            _.set(response, 'message', `${lastRunList[0].statusCode} - ${lastRunList[0].statusMessage}`);
            return _.set(response, 'status', CONST.OPERATION.FAILED);
          }
        }
      });
  }
}

module.exports = ServiceInstanceUpdateJob;