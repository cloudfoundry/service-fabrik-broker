'use strict';

const _ = require('lodash');
const logger = require('@sf/logger');
const { catalog } = require('@sf/models');
const config = require('@sf/app-config');
const { apiServerClient } = require('@sf/eventmesh');
const {
  CONST,
  commonFunctions: {
    retry,
    buildErrorJson
  }
} = require('@sf/common-utils');
/* jshint ignore:start */
const maas = require('@sf/metering');
/* jshint ignore:end */
const { EventLogInterceptor } = require('@sf/event-logger');
const BaseJob = require('./BaseJob');

class MeterInstanceJob extends BaseJob {

  /* jshint ignore:start */
  static async run(job, done) {
    try {
      logger.info(`-> Starting MeterInstanceJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - with options: ${JSON.stringify(job.attrs.data)} `);
      const events = await this.getInstanceEvents(job.attrs.data);
      logger.debug('Received metering events -> ', events);
      let meterResponse = await this.meter(events);
      return this.runSucceeded(meterResponse, job, done);
    } catch (err) {
      return this.runFailed(err, {}, job, done);
    }
  }
  /* jshint ignore:end */

  static getInstanceEvents(data) {
    const instance_guid = _.get(data, 'instance_guid');
    let selector = `state in (${CONST.METER_STATE.TO_BE_METERED},${CONST.METER_STATE.FAILED})`;
    if(instance_guid !== undefined) {
      selector = selector + `,instance_guid=${instance_guid}`;
    }
    const options = {
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
      query: {
        labelSelector: selector
      }
    };
    return apiServerClient.getResources(options);
  }

  /* jshint ignore:start */
  static async meter(events, attempts) {
    try {
      logger.info(`Number of events to be metered in this run - ${events.length}`);
      // Adding this comment as we are transitioning to async/await
      // Note: The below Promise is not bluebird promise
      const resultArray = await Promise.all(_.map(events, async event =>
        await this.sendEvent(event, attempts)));
      const successCount = resultArray.filter(r => r === true).length;
      return {
        totalEvents: events.length,
        success: successCount,
        failed: events.length - successCount
      };
    } catch (err) {
      logger.error('Error occurred while metering all events : ', err);
    }
  }
  /* jshint ignore:end */

  static isServicePlanExcluded(options) {
    const serviceId = _.get(options, 'service.service_guid');
    const planId = _.get(options, 'service.plan_guid');
    const plan = catalog.getPlan(planId);
    const metered = _.get(plan, 'metered', false);
    logger.info(`Meter status of Service ${serviceId}, plan: ${planId} : ${metered}`);
    return !metered;
  }

  static enrichEvent(options) {
    // Add region , service name and plan sku name of the event
    const serviceId = _.get(options, 'service.service_guid');
    const planId = _.get(options, 'service.plan_guid');
    options.service.id = catalog.getServiceName(serviceId);
    options.service.plan = catalog.getPlanSKUFromPlanGUID(serviceId, planId);
    options.service = _.omit(options.service, ['service_guid', 'plan_guid']);
    options.consumer.region = config.metering.region;
    if (!options.consumer.environment) {
      // By default environment should be cloudfoundry for now
      options.consumer.environment = 'CF';
    }
    logger.info('Enriched metering document', options);
    return options;
  }

  /* jshint ignore:start */
  static async sendEvent(event, attempts) {
    try {
      logger.debug('Metering Event details before enriching:', event);
      if (this.isServicePlanExcluded(event.spec.options) === true) {
        await this.updateMeterState(CONST.METER_STATE.EXCLUDED, event);
        return true;
      }
      const enrichedUsageDoc = await this.enrichEvent(_.get(event.spec, 'options'));
      logger.info('Sending enriched document:', enrichedUsageDoc);
      const validEvent = await retry(tries => {
        logger.debug(`Sending usage document, try: ${tries}`);
        return maas.client.sendUsageRecord({
          usage: [enrichedUsageDoc]
        });
      }, {
        maxAttempts: attempts || 4,
        minDelay: 1000
      });
      if (validEvent !== undefined) {
        await this.updateMeterState(CONST.METER_STATE.METERED, event);
      }
      await MeterInstanceJob._logMeteringEvent(undefined, event);
      return true;
    } catch (err) {
      logger.error('Error occured while metering:', err);
      await MeterInstanceJob._logMeteringEvent(err, event);
      await this.updateMeterState(CONST.METER_STATE.FAILED, event, err);
      return false;
    }
  }
  /* jshint ignore:end */

  static getInstanceType(event) {
    const instanceType = CONST.INSTANCE_TYPE.DIRECTOR;
    return instanceType;
  }

  static _logMeteringEvent(err, event) {
    const eventLogger = EventLogInterceptor.getInstance(config.internal.event_type, 'internal');
    const request = {
      instance_id: _.get(event, 'metadata.labels.instance_guid'),
      event_type: _.get(event, 'metadata.labels.event_type')
    };
    const instanceType = MeterInstanceJob.getInstanceType(event);
    if (err !== undefined) {
      const now = new Date();
      const secondsSinceEpoch = Math.round(now.getTime() / 1000);
      const createSecondsSinceEpoch = Math.round(Date.parse(event.spec.options.timestamp) / 1000);
      logger.debug(`Metering event creation timestamp: ${event.spec.options.timestamp} (${createSecondsSinceEpoch}), Current time: ${now} ${secondsSinceEpoch}`);
      // Threshold needs to be greater than the metering job frequency
      const thresholdHours = _.get(config.metering,'error_threshold_hours', 0);
      if (secondsSinceEpoch - createSecondsSinceEpoch > thresholdHours * 60 * 60) {
        logger.debug(`Publishing log event for error: ${err}, for event:`, event);
        const resp = {
          statusCode: _.get(err,'status', CONST.HTTP_STATUS_CODE.TIMEOUT)
        };
        const check_res_body = false;
        return eventLogger.publishAndAuditLogEvent(CONST.URL.METERING_USAGE, CONST.HTTP_METHOD.PUT, request, resp, check_res_body, instanceType);
      }
    } else {
      logger.debug('Publishing log event for success for event:', event);
      const resp = {
        statusCode: CONST.HTTP_STATUS_CODE.OK
      };
      const check_res_body = false;
      return eventLogger.publishAndAuditLogEvent(CONST.URL.METERING_USAGE, CONST.HTTP_METHOD.PUT, request, resp, check_res_body, instanceType);
    }
  }

  static updateMeterState(status, event, err) {
    return retry(tries => {
      logger.debug(`Updating meter state to ${status} for event, try: ${tries}`, event);
      let status_obj = {
        state: status
      };
      if (err !== undefined) {
        status_obj.error = buildErrorJson(err);
      }
      return apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
        resourceId: `${event.metadata.name}`,
        status: status_obj
      });
    }, {
      maxAttempts: 4,
      minDelay: 1000
    })
      .tap(response => logger.info('Successfully updated meter state : ', response));
  }
}

module.exports = MeterInstanceJob;
