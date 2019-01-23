'use strict';

const _ = require('lodash');
const moment = require('moment');
const Promise = require('bluebird');
const logger = require('../common/logger');
const BaseJob = require('./BaseJob');
const catalog = require('../common/models/catalog');
const config = require('../common/config');
const maas = require('../data-access-layer/metering');

const apiServerClient = require('../data-access-layer/eventmesh').apiServerClient;
const CONST = require('../common/constants');

class MeterInstanceJob extends BaseJob {
  static run(job, done) {
    return Promise.try(() => {
      logger.debug('Starting MeterInstanceJob Job');
      this.getInstanceEvents()
        .tap(events => logger.info('recieved events -> ', events))
        .then(events => this.meter(events))
        .then((meterResponse) => this.runSucceeded(meterResponse, job, done))
        .catch((err) => this.runFailed(err, {}, job, done));
    });
  }

  static getInstanceEvents() {
    const options = {
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
      query: {
        labelSelector: `meter_state=${CONST.METER_STATE.TO_BE_METERED}`
      }
    };
    return apiServerClient._getResources(options);
  }

  static meter(events) {
    logger.info(`Number of events to be metered in this run - ${events.length}`);
    return Promise.try(() => {
      let successCount = 0,
        failureCount = 0,
        failedEvents = [];
      return Promise.map(events, (event) => {
          return this
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
            });
        }).then(() => {
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
    const serviceName = this.getServiceNameFromServiceGUID(serviceId);
    const planName = this.getPlanSKUFromPlanGUID(serviceId, planId);
    const excluded_service_names = _.map(config.metering.excluded_service_plans, p => p.service_name);
    if (_.indexOf(excluded_service_names, serviceName) >= 0) {
      const excluded_plans = _
        .chain(config.metering.excluded_service_plans)
        .filter(p => p.service_name === serviceName)
        .head()
        .get('plan_sku_names')
        .value();
      logger.info(`Excluded plans for ${serviceName}:`, excluded_plans);
      if (_.indexOf(excluded_plans, planName) >= 0) {
        logger.info(`The metering event guid: ${options.id} with ${serviceName}, ${planName} is excluded`);
        return true;
      }
    }
    return false;
  }

  static enrichEvent(options) {
    // Add region , service name and plan sku name and fix timestamp of the event
    const serviceId = _.get(options, 'service.id');
    const planId = _.get(options, 'service.plan');
    const timestamp = _.get(options, 'timestamp');
    options.service.id = this.getServiceNameFromServiceGUID(serviceId);
    options.service.plan = this.getPlanSKUFromPlanGUID(serviceId, planId);
    options.timestamp = moment(timestamp).format('YYYY-MM-DDTHH:mm:ss.SSS');
    options.consumer.region = config.metering.region;
    return options;
  }

  static getServiceNameFromServiceGUID(serviceGuid) {
    return _.chain(catalog.toJSON().services)
      .map((s) => s.id === serviceGuid ? s.name : undefined)
      .filter(s => s !== undefined)
      .head()
      .value();
  }

  static getPlanSKUFromPlanGUID(serviceGuid, planGuid) {
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

  static getPlanNameFromPlanGUID(serviceGuid, planGuid) {
    const service = _.chain(catalog.toJSON().services)
      .map((s) => s.id === serviceGuid ? s : undefined)
      .filter(s => s !== undefined)
      .head()
      .value();
    return _
      .chain(service.plans)
      .map((p) => p.id === planGuid ? p.name : undefined)
      .filter(p => p !== undefined)
      .head()
      .value();
  }

  static sendEvent(event) {
    const eventGuid = _.get(event, 'spec.options.id');
    if (this.isServicePlanExcluded(event.spec.options)) {
      return Promise.try(() => this.updateMeterState(CONST.OPERATION.EXCLUDED, eventGuid, event))
      .return(true)
    }
    return Promise
      .try(() => this.enrichEvent(event.spec.options))
      .then(enriched_usage_doc => {
        logger.debug('Sending document:', enriched_usage_doc);
        return maas.client.putUsageRecord(enriched_usage_doc);
      })
      .then(validEvent => validEvent ? this.updateMeterState(CONST.OPERATION.SUCCEEDED, eventGuid, event) : false)
      .return(true)
      .catch(err => {
        logger.error('Error occurred while metering event : ', event);
        logger.error('Error Details - ', err);
        return this
          .updateMeterState(CONST.OPERATION.FAILED, eventGuid, event)
          .return(false);
      });
  }

  static updateMeterState(status, eventGuid, event) {
    return apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
        resourceId: `${event.spec.options.id}`,
        status: {
          meter_state: status
        }
      })
      .tap((response) => logger.info('Successfully updated meter state : ', response));
  }
}

module.exports = MeterInstanceJob;