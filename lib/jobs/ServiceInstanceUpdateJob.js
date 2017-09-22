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
      .getOutdatedDiff(instanceDetails.deployment_name, plan)
      .then(diffList => {
        const outdated = diffList.length !== 0;
        operationResponse.deployment_outdated = outdated;
        operationResponse.diff = diffList;
        if (!outdated) {
          operationResponse.update_init = 'NA';
          logger.info(`Instance: ${instanceDetails.instance_name} - Deployment: ${instanceDetails.deployment_name} up-to date. No update required.`);
          return operationResponse;
        }
        let trackAttempts = true;
        return this
          .updateDeployment(
            instanceDetails.deployment_name,
            diffList,
            plan.service.force_update)
          .then(result => {
            operationResponse.update_init = CONST.OPERATION.SUCCEEDED;
            operationResponse.update_operation_guid = result.guid;
            return operationResponse;
          })
          .catch(err => {
            operationResponse.update_init = CONST.OPERATION.FAILED;
            logger.error('Error occurred while updating service insance job :', err);
            if (err instanceof errors.DeploymentAlreadyLocked) {
              //If deployment locked then backup is in progress. So reschedule update job,
              //Retry attempts dont count when deployment is locked for backup.
              trackAttempts = false;
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

  static getOutdatedDiff(deploymentName, plan) {
    return Fabrik
      .createManager(plan)
      .then((directorManager) => directorManager
        .diffManifest(deploymentName)
        .then(result => result.diff));
  }

  static updateDeployment(deploymentName, diff, skipForbiddenCheck) {
    return Promise
      .try(() => {
        if (!skipForbiddenCheck) {
          this.isChangesPresentInForbiddenSections(diff);
        }
      })
      .then(() => Fabrik
        .createOperation('update', {
          deployment: deploymentName,
          username: 'Auto_Update_Job',
          arguments: {}
        })
        .invoke())
      .then(result => ({
        guid: result.guid
      }));
  }

  static isChangesPresentInForbiddenSections(diff) {
    const forbiddenSections = _
      .chain(diff)
      .map(_.first)
      .filter(line => /^[a-z]\w+:/.test(line))
      .map(line => _.nth(/^([a-z]\w+):/.exec(line), 1))
      .difference([
        'update',
        'compilation',
        'releases',
        'resource_pools',
        'networks',
        'properties'
      ])
      .value();
    if (!_.isEmpty(forbiddenSections) && !_.includes(forbiddenSections, 'director_uuid')) {
      throw new errors.Forbidden(`Automatic update not possible. Detected changes in forbidden section(s) '${forbiddenSections.join(',')}'`);
    }
    return false;
  }

  static rescheduleUpdateJob(instanceDetails, trackAttempts) {
    return Promise.try(() => {
      if (instanceDetails.attempt === undefined) {
        instanceDetails.attempt = 1;
        instanceDetails.firstAttemptAt = new Date();
      } else {
        instanceDetails.attempt = instanceDetails.attempt + 1;
      }
      if (trackAttempts) {;
        if (instanceDetails.attempt > config.scheduler.jobs.service_instance_update.max_attempts) {
          logger.error(`Auto udpate for instance ${instanceDetails.instance_id}  has exceeded max configured attempts : ${config.scheduler.jobs.service_instance_update.max_attempts}}`);
          return;
        }
      }
      logger.info(`Schedulding InstanceUpdate Job for ${instanceDetails.instance_name}:${instanceDetails.instance_id} @ ${config.scheduler.jobs.reschedule_delay} - Track : ${trackAttempts} - Attempt - ${instanceDetails.attempt}`);
      const jobData = _.cloneDeep(instanceDetails);
      return ScheduleManager
        .runAt(instanceDetails.instance_id,
          CONST.JOB.SERVICE_INSTANCE_UPDATE,
          config.scheduler.jobs.reschedule_delay,
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
}

module.exports = ServiceInstanceUpdateJob;