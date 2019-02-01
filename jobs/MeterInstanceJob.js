'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../common/logger');
const BaseJob = require('./BaseJob');
const catalog = require('../common/models/catalog');
const config = require('../common/config');
const utils = require('../common/utils');
const EventLogInterceptor = require('../common/EventLogInterceptor');
const maas = require('../data-access-layer/metering');
const apiServerClient = require('../data-access-layer/eventmesh').apiServerClient;
const CONST = require('../common/constants');

class MeterInstanceJob extends BaseJob {
  static run(job, done) {
    return Promise.try(() => {
      logger.info(`-> Starting MeterInstanceJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - with options: ${JSON.stringify(job.attrs.data)} `);
      this.getInstanceEvents()
        .tap(events => logger.info('recieved events -> ', events))
        .then(events => this.meter(events))
        .then(meterResponse => this.runSucceeded(meterResponse, job, done))
        .catch((err) => this.runFailed(err, {}, job, done));
    });
  }

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

  static meter(events) {
    logger.info(`Number of events to be metered in this run - ${events.length}`);
    return Promise.try(() => {
      let successCount = 0,
        failureCount = 0,
        failedEvents = [];
      return Promise.map(events, (event) => this
          .sendEvent(event)
          .then((status) => {
            if (status) {
              successCount++;
            } else {
              failureCount++;
              failedEvents.push(event);
            }
          })
          .catch(err => {
            logger.error(`Error occurred while metering event : `, err);
          })
        ).then(() => {
          return {
            totalEvents: events.length,
            success: successCount,
            failed: failureCount,
            failedEvents: failedEvents
          };
        })
        .catch(err => {
          logger.error(`Error occurred while metering all events : `, err);
        });

    });
  }

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

  static sendEvent(event) {
    logger.debug('Event details before enriching:', event);
    return Promise.try(() => {
        if (this.isServicePlanExcluded(event.spec.options) === true) {
          return Promise.try(() => this.updateMeterState(CONST.METER_STATE.EXCLUDED, event))
            .return(true);
        }
        return Promise
          .try(() => this.enrichEvent(event.spec.options))
          .then(enrichedUsageDoc => {
            logger.info('Sending enriched document:', enrichedUsageDoc);
            return maas.client.sendUsageRecord({
              usage: [enrichedUsageDoc]
            });
          })
          .then(validEvent => validEvent ? this.updateMeterState(CONST.METER_STATE.METERED, event) : false)
          .return(true);
      })
      .catch(err => {
        logger.error('Error occured while metering:', err);
        return Promise.try(() => this._logMeteringEvent(err, event))
          .then(() => this.updateMeterState(CONST.METER_STATE.FAILED, event, err))
          .return(false);
      });
  }

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