'use strict';

module.exports = Object.freeze({
  NETWORK_SEGMENT_LENGTH: 4,
  BOSH_POLL_MAX_ATTEMPTS: 3,
  DEPLOYMENT_LOCK_NAME: '_LOCK_',
  SERVICE_FABRIK_PREFIX: 'service-fabrik',
  OPERATION: {
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    ABORTED: 'aborted',
    IN_PROGRESS: 'in progress',
    ABORTING: 'aborting'
  },
  OPERATION_TYPE: {
    BACKUP: 'backup',
    RESTORE: 'restore',
    UNLOCK: 'unlock'
  },
  URL: {
    backup: '/api/v1/service_instances/:instance_id/backup',
    restore: '/api/v1/service_instances/:instance_id/restore',
    backup_by_guid: '/api/v1/backups/:backup_guid'
  },
  INSTANCE_TYPE: {
    DIRECTOR: 'director',
    DOCKER: 'docker'
  },
  HTTP_METHOD: {
    POST: 'POST',
    GET: 'GET',
    DELETE: 'DELETE',
    PUT: 'PUT'
  },
  JOB: {
    //Define names of scheduled JOBS
    SCHEDULED_BACKUP: 'ScheduledBackup',
    SERVICE_FABRIK_BACKUP: 'ServiceFabrikBackup',
    BACKUP_STATUS_POLLER: 'FabrikStatusPoller',
    SCHEDULED_OOB_DEPLOYMENT_BACKUP: 'ScheduledOobDeploymentBackup',
    OPERATION_STATUS_POLLER: 'OperationStatusPoller',
    BLUEPRINT_JOB: 'BluePrintJob',
    BAKUP_REAPER: 'BackupReaper'
  },
  JOB_SCHEDULER: {
    WORKER_CREATE_DELAY: 60000,
    SHUTDOWN_WAIT_TIME: 5000
  },
  BACKUP: {
    TYPE: {
      ONLINE: 'online'
    },
    TRIGGER: {
      SCHEDULED: 'scheduled',
      ON_DEMAND: 'on-demand',
      MANUAL: 'manual' //This is actually scheduled backup via existing cron jobs. Could be removed 14 days after the current solution goes live.
    },
    SCHEDULE: {
      DAILY: 'daily'
    }
  },
  DB_MODEL: {
    //Define all DB Model names
    JOB: 'JobDetail',
    JOB_RUN_DETAIL: 'JobRunDetail'
  },
  //Topic naming convention: {GROUP}.{EVENT_NAME}
  //Reasoning: pubsub module allow for dotted notation of event names and one can subscribe to all events even at group level
  TOPIC: {
    MONGO_OPERATIONAL: 'MONGODB.OPERATIONAL',
    MONGO_INIT_FAILED: 'MONGODB.INIT_FAILIED',
    MONGO_SHUTDOWN: 'MONGODB.SHUTDOWN',
    APP_SHUTTING_DOWN: 'APP.SHUTTING_DOWN',
    APP_STARTUP: 'APP.STARTUP',
    INTERRUPT_RECIEVED: 'APP.SIGINT_RECIEVED',
    SCHEDULER_READY: 'APP.SCHEDULER_READY',
    SCHEDULER_STARTED: 'APP.SCHEDULER_STARTED'
  },
  USER: {
    SYSTEM: 'system'
  },
  FEATURE: {
    SCHEDULED_BACKUP: 'ScheduledBackup',
    SCHEDULED_OOB_DEPLOYMENT_BACKUP: 'ScheduledOobDeploymentBackup'
  },
  DB: {
    CONNECTION_STATE: {
      WAIT_FOR_START: 0,
      CONNECTED: 1,
      DISCONNECTED: 2,
      SHUTTING_DOWN: 3
    }
  },
  //BELOW UUIDs are taken from MongoDB Manifest for v3.0-dedicated-xsmall
  FABRIK_INTERNAL_MONGO_DB: {
    SERVICE_ID: '3c266123-8e6e-4034-a2aa-e48e13fbf893',
    PLAN_ID: '2fff2c4d-7c31-4ed7-b505-0aeafbd8c0e2',
    ORG_ID: 'FABDEC11-FABD-FABD-FABD-FABDECFABDEC', //Random valid UUID string made from FABDEC phonotically similar to FABRIK
    SPACE_ID: 'FABDEC22-FABD-FABD-FABD-FABDECFABDEC',
    INSTANCE_ID: 'FABDEC33-FABD-FABD-FABD-FABDECFABDEC',
    BINDING_ID: 'FABDEC44-FABD-FABD-FABD-FABDECFABDEC'
  },
  // Quota API response codes
  QUOTA_API_RESPONSE_CODES: {
    VALID_QUOTA: 0,
    INVALID_QUOTA: 1,
    NOT_ENTITLED: 2
  },
  // Quota API Constants
  QUOTA_API_AUTH_CLIENT: {
    CONTENT_TYPE: 'application/x-www-form-urlencoded',
    ACCEPT: 'application/json'
  },
  ERR_CODES: {
    UNKNOWN: 'ERR-CODE-UNKNOWN',
    PRE_CONDITION_NOT_MET: 'PRE_CONDITION_NOT_MET',
    DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS: 'DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS'
  },
  //OOB Deployments
  FABRIK_OUT_OF_BAND_DEPLOYMENTS: {
    ROOT_FOLDER_NAME: 'OOB_DEPLOYMENTS'
  },
  //BOSH Directors
  BOSH_DIRECTORS: {
    BOOSTRAP_BOSH: 'bootstrap-bosh',
    BOSH: 'bosh'
  }
});