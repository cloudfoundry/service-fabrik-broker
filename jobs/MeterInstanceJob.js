'use strict';

const _ = require('lodash');
const logger = require('../common/logger');
const BaseJob = require('./BaseJob');
const catalog = require('../common/models/catalog');
const config = require('../common/config');
const utils = require('../common/utils');
const EventLogInterceptor = require('../common/EventLogInterceptor');
/* jshint ignore:start */
const maas = require('../data-access-layer/metering');
/* jshint ignore:end */
const apiServerClient = require('../data-access-layer/eventmesh').apiServerClient;
const CONST = require('../common/constants');

class MeterInstanceJob extends BaseJob {

  /* jshint ignore:start */
  static async run(job, done) {
    try {
      logger.info(`-> Starting MeterInstanceJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - with options: ${JSON.stringify(job.attrs.data)} `);
      let events = await this.getInstanceEvents()
      logger.info('recieved events -> ', events)
      let meterResponse = await this.meter(events)
      return this.runSucceeded(meterResponse, job, done)
    } catch (err) {
      return this.runFailed(err, {}, job, done)
    }
  }
  /* jshint ignore:end */

  static getInstanceEvents() {
    const options = {
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
      query: {
        labelSelector: `state in (${CONST.METER_STATE.TO_BE_METERED},${CONST.METER_STATE.FAILED})`
      }
    };
    return apiServerClient.getResources(options);
  }

  /* jshint ignore:start */
  static async meter(events) {
    try {
      logger.info(`Number of events to be metered in this run - ${events.length}`);
      // Adding this comment as we are transitioning to async/await
      // Note: The below Promise is not bluebird promise
      let promiseArray = await Promise.all(_.map(events, async (event) =>
        await this.sendEvent(event)));
      let successCount = promiseArray.filter(r => r === true).length;
      return {
        totalEvents: events.length,
        success: successCount,
        failed: events.length - successCount,
      }
    } catch (err) {
      logger.error(`Error occurred while metering all events : `, err);
    }
  }
  /* jshint ignore:end */

  static isServicePlanExcluded(options) {
    const serviceId = _.get(options, 'service.id');
    const planId = _.get(options, 'service.plan');
    logger.info(`Checking if service ${serviceId}, plan: ${planId} is excluded`);
    const plan = catalog.getPlan(planId);
    return !plan.metered;
  }

  static enrichEvent(options) {
    // Add region , service name and plan sku name of the event
    const serviceId = _.get(options, 'service.id');
    const planId = _.get(options, 'service.plan');
    logger.info(`Enriching the metering event ${serviceId}, plan: ${planId}`);
    options.service.id = catalog.getServiceName(serviceId);
    options.service.plan = this.getPlanSKUFromPlanGUID(serviceId, planId);
    options.consumer.region = config.metering.region;
    return options;
  }

  static getPlanSKUFromPlanGUID(serviceGuid, planGuid) {
    logger.info(`Getting Plan SKU for service ${serviceGuid}, plan: ${planGuid}`);
    const service = _.chain(catalog.toJSON().services)
      .map((s) => s.id === serviceGuid ? s : undefined)
      .filter(s => s !== undefined)
      .head()
      .value();
    return _
      .chain(service.plans)
      .map((p) => p.id === planGuid ? p.sku_name : undefined)
      .filter(p => p !== undefined)
      .head()
      .value();
  }

  /* jshint ignore:start */
  static async sendEvent(event) {
    try {
      logger.debug('Event details before enriching:', event);
      if (this.isServicePlanExcluded(event.spec.options) === true) {
        await this.updateMeterState(CONST.METER_STATE.EXCLUDED, event);
        return true;
      }
      let enrichedUsageDoc = await this.enrichEvent(event.spec.options);
      logger.info('Sending enriched document:', enrichedUsageDoc);
      let validEvent = await maas.client.sendUsageRecord({
        usage: [enrichedUsageDoc]
      });
      validEvent ? this.updateMeterState(CONST.METER_STATE.METERED, event) : false;
      return true;
    } catch (err) {
      logger.error('Error occured while metering:', err);
      await this._logMeteringEvent(err, event);
      await this.updateMeterState(CONST.METER_STATE.FAILED, event, err);
      return false;
    }
  }
  /* jshint ignore:end */

  static _logMeteringEvent(err, event) {
    let now = new Date();
    let secondsSinceEpoch = Math.round(now.getTime() / 1000);
    let createSecondsSinceEpoch = Math.round(Date.parse(event.spec.options.timestamp) / 1000);
    logger.debug(`Event Creation timestamp: ${event.spec.options.timestamp} (${createSecondsSinceEpoch}), Current time: ${now} ${secondsSinceEpoch}`);
    // Threshold needs to be greater than the metering job frequency
    const thresholdHours = config.metering.error_threshold_hours;
    if (secondsSinceEpoch - createSecondsSinceEpoch > thresholdHours * 60 * 60) {
      logger.debug(`Publishing log event for error: ${err}, for event:`, event);
      const eventLogger = EventLogInterceptor.getInstance(config.internal.event_type, 'internal');
      const resp = {
        statusCode: err.status
      };
      const check_res_body = false;
      return eventLogger.publishAndAuditLogEvent(CONST.URL.METERING_USAGE, CONST.HTTP_METHOD.PUT, event, resp, check_res_body);
    }
  }

  static updateMeterState(status, event, err) {
    logger.debug(`Updating meter state to ${status} for event`, event);
    let status_obj = {
      state: status
    };
    if (err !== undefined) {
      status_obj.error = utils.buildErrorJson(err);
    }
    return apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
        resourceId: `${event.metadata.name}`,
        status: status_obj
      })
      .tap((response) => logger.info('Successfully updated meter state : ', response));
  }
}

module.exports = MeterInstanceJob;