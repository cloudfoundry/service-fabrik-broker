'use strict';

const _ = require('lodash');

const {
  CONST,
  commonFunctions:{
    retry,
    sleep
  }

} = require('@sf/common-utils');
const config = require('@sf/app-config');
const logger = require('@sf/logger');
const { apiServerClient } = require('@sf/eventmesh');
const { meteringArchiveStore } = require('@sf/iaas');
const BaseJob = require('./BaseJob');

class ArchiveMeteredEventsJob extends BaseJob {

  static async run(job, done) {
    try {
      logger.info(`-> Starting ArchiveMeteredEventsJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - with options: ${JSON.stringify(job.attrs.data)} `);
      const events = await this.getMeteredEvents();
      logger.info(`Total number of metered events obtained from ApiServer: ${events.length}`);
      if(events.length != 0) {
        const meteringFileTimeStamp = new Date();
        const successfullyPatchedEvents = await this.patchToMeteringStore(events, meteringFileTimeStamp.toISOString(), job.attrs.data.sleepDuration, job.attrs.data.deleteAttempts);
        logger.info(`No of processed metered events: ${successfullyPatchedEvents}`);
      }
      const excludedEvents = await this.getExcludedEvents();
      logger.info(`Total number of excluded events obtained from ApiServer: ${excludedEvents.length}`);
      if(excludedEvents.length === 0) {
        return this.runSucceeded({}, job, done);
      }
      const deletedExcludedEvents = await this.deleteExcludedEvents(excludedEvents, job.attrs.data.sleepDuration);
      logger.info(`No of deleted excluded events: ${deletedExcludedEvents}`);
      return this.runSucceeded({}, job, done);
    } catch(err) {
      return this.runFailed(err, {}, job, done);
    }
  }

  static async getMeteredEvents() {
    let selector = `state in (${CONST.METER_STATE.METERED})`;
    const options = {
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
      query: {
        labelSelector: selector
      }
    };
    return apiServerClient.getResources(options);
  }

  static async getExcludedEvents() {
    let selector = `state in (${CONST.METER_STATE.EXCLUDED})`;
    const options = {
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
      query: {
        labelSelector: selector
      }
    };
    return apiServerClient.getResources(options); 
  }

  static async deleteExcludedEvents(events, sleepDuration) {
    try {
      const noEventsToDelete = Math.min(_.get(config, 'system_jobs.archive_metered_events.job_data.events_to_patch', CONST.ARCHIVE_METERED_EVENTS_RUN_THRESHOLD), events.length);
      const eventsToDelete = _.slice(events, 0, noEventsToDelete);
      for(let i = 0; i < eventsToDelete.length; i++) {
        await apiServerClient.deleteResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
          resourceId: `${eventsToDelete[i].metadata.name}`
        });
        await sleep(sleepDuration || 1000);
      }
      return noEventsToDelete;
    } catch(err) {
      logger.error('Error while deleting excluded events from ApiServer: ', err);
      throw err;
    }
  }

  static async patchToMeteringStore(events, timeStamp, sleepDuration, attempts) {
    try {
      await meteringArchiveStore.putArchiveFile(timeStamp);
      const noEventsToPatch = Math.min(_.get(config, 'system_jobs.archive_metered_events.job_data.events_to_patch', CONST.ARCHIVE_METERED_EVENTS_RUN_THRESHOLD), events.length);
      const eventsToPatch = _.slice(events, 0, noEventsToPatch);
      for(let i = 0; i < eventsToPatch.length; i++) {
        await this.processEvent(eventsToPatch[i], timeStamp, attempts || 4);
        await sleep(sleepDuration || 1000);
      }
      return noEventsToPatch;
    } catch(err) {
      logger.error('Error while archiving events in the MeteringStore: ', err);
      throw err;
    }
  }

  static async processEvent(event, timeStamp, attempts) {
    logger.info(`Processing event: ${event.metadata.name}`);
    await meteringArchiveStore.patchEventToArchiveFile(event, timeStamp);
    return retry(tries => {
      logger.debug(`Trying to delete ${event.metadata.name}. Total retries yet: ${tries}`);
      return apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.SFEVENT,
        resourceId: `${event.metadata.name}`
      });
    }, {
      maxAttempts: attempts || 4,
      minDelay: 1000
    });
  }
}

module.exports = ArchiveMeteredEventsJob;
