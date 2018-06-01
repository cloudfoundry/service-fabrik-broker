'use strict';

module.exports = Object.freeze({
  NETWORK_SEGMENT_LENGTH: 4,
  BOSH_POLL_MAX_ATTEMPTS: 3,
  BOSH_RATE_LIMITS: {
    BOSH_CONTEXT_ID: 'X-Bosh-Context-Id',
    BOSH_FABRIK_OP: 'Fabrik::Operation::',
    BOSH_FABRIK_OP_AUTO: 'Fabrik::Operation::Auto',
    BOSH_FABRIK_OP_MONGO: 'Fabrik::Operation::MongoDB',
    BOSH_PROCESSING: 'processing',
    BOSH_CANCELLING: 'cancelling'
  },
  FABRIK_SCHEDULED_OPERATION: 'scheduled',
  UNCATEGORIZED: 'uncategorized',
  DEPLOYMENT_LOCK_NAME: '_LOCK_',
  SERVICE_FABRIK_PREFIX: 'service-fabrik',
  PLATFORM_CONTEXT_KEY: 'platform-context',
  NOT_APPLICABLE: 'NA',
  FINISHED_JOBS_RETENTION_DURATION_DAYS: 14,
  EVENT_LOG_RIEMANN_CLIENT: {
    MAX_QUEUE_SIZE: 100,
    MAX_SEND_RETRIES: 2
  },
  ETCD: {
    SORT_BY_CREATE: 'Create',
    TARGET_NONE: 'None',
    JSON: 'json',
    NUMBER: 'number',
    STRING: 'string'
  },
  EVENT_LOG_RIEMANN_CLIENT_STATUS: {
    INITIALIZING: 'initializing',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected'
  },
  ETCD_POLLER_DELAY: 2000,
  OPERATION: {
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    ABORTED: 'aborted',
    IN_PROGRESS: 'in progress',
    ABORTING: 'aborting'
  },
  SF_BROKER_API_VERSION_MIN: '2.12',
  OPERATION_TYPE: {
    BACKUP: 'backup',
    RESTORE: 'restore',
    UNLOCK: 'unlock',
    LOCK: '__Locked__',
    CREATE: 'create',
    UPDATE: 'update',
    BIND: 'bind',
    UNBIND: 'unbind',
    DELETE: 'delete'
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
    PUT: 'PUT',
    PATCH: 'PATCH'
  },
  HTTP_STATUS_CODE: {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    NOT_ACCEPTABLE: 406,
    CONFLICT: 409,
    GONE: 410,
    PRECONDITION_FAILED: 412,
    UNPROCESSABLE_ENTITY: 422
  },
  JOB_NAME_ATTRIB: '_n_a_m_e_',
  JOB: {
    //Define names of scheduled JOBS
    SCHEDULED_BACKUP: 'ScheduledBackup',
    SERVICE_FABRIK_BACKUP: 'ServiceFabrikBackup',
    BACKUP_STATUS_POLLER: 'FabrikStatusPoller',
    SCHEDULED_OOB_DEPLOYMENT_BACKUP: 'ScheduledOobDeploymentBackup',
    OPERATION_STATUS_POLLER: 'OperationStatusPoller',
    BNR_STATUS_POLLER: 'BnRStatusPoller',
    BLUEPRINT_JOB: 'BluePrintJob',
    BACKUP_REAPER: 'BackupReaper',
    SERVICE_INSTANCE_UPDATE: 'ServiceInstanceAutoUpdate',
    DB_COLLECTION_REAPER: 'DbCollectionReaper'
  },
  JOB_RUN_STATUS_CODE: {
    SUCCEEDED: '0'
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
    }
  },
  SCHEDULE: {
    DAILY: 'daily',
    RANDOM: 'random',
  },
  SCHEDULE_INTERVAL: {
    HUMAN_INTERVAL: 'human-readable-interval',
    CRON_EXPRESSION: 'cron_expression'
  },
  DB_MODEL: {
    //Define all DB Model names
    JOB: 'JobDetail',
    JOB_RUN_DETAIL: 'JobRunDetail',
    MAINTENANCE_DETAIL: 'MaintenanceDetail',
    EVENT_DETAIL: 'EventDetail'
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
  SYSTEM_USER: {
    name: 'system'
  },
  FEATURE: {
    SCHEDULED_BACKUP: 'ScheduledBackup',
    SCHEDULED_UPDATE: 'ServiceInstanceAutoUpdate',
    SCHEDULED_OOB_DEPLOYMENT_BACKUP: 'ScheduledOobDeploymentBackup'
  },
  DB: {
    CONNECTION_STATE: {
      WAIT_FOR_START: 0,
      CONNECTED: 1,
      DISCONNECTED: 2,
      SHUTTING_DOWN: 3
    },
    STATE: {
      NOT_CONFIGURED: 'NOT_CONFIGURED',
      TB_INIT: 'TO_BE_INITIALIZED',
      INIT_FAILED: 'INIT_FAILED',
      CREATE_UPDATE_IN_PROGRESS: 'CREATE_UPDATE_IN_PROGRESS',
      CREATE_UPDATE_SUCCEEDED: 'CREATE_UPDATE_SUCCEEDED',
      BIND_IN_PROGRESS: 'BIND_IN_PROGRESS',
      CONNECTING: 'CONNECTING',
      CONNECTED: 'CONNECTED',
      DISCONNECTED: 'DISCONNECTED',
      CONNECTION_FAILED: 'CONNECTION_FAILED',
      CREATE_UPDATE_FAILED: 'CREATE_UPDATE_FAILED',
      BIND_FAILED: 'BIND_FAILED',
      SHUTTING_DOWN: 'SHUTTING_DOWN'
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
    DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS: 'DEPLOYMENT_NAME_DUPED_ACROSS_DIRECTORS',
    SF_IN_MAINTENANCE: 101,
    INTERNAL_ERROR: 4
    //Error codes should always be readable strings. However few error codes (used as process exit codes) must be int.
    //Guideline : Only in cases where it is mandatory to have int, error codes should be so else they must always be Strings.
  },
  BOSH_ERR_CODES: {
    DEPLOYMENT_NOT_FOUND: 70000
  },
  //OOB Deployments
  FABRIK_OUT_OF_BAND_DEPLOYMENTS: {
    ROOT_FOLDER_NAME: 'OOB_DEPLOYMENTS',
    DEFAULT_DELETE_DELAY: 1000
  },
  //BOSH Directors
  BOSH_DIRECTORS: {
    BOSH_SF: 'bosh-sf',
    BOSH: 'bosh'
  },
  ORDINALS: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'],
  IAAS: {
    AZURE: 'azure'
  },
  REPORT_BACKUP: {
    INPUT_DATE_FORMAT: 'YYYY-MM-DD',
    SORT: {
      ASC: 1,
      DESC: -1
    }
  },
  RESOURCE_STATE: {
    IN_QUEUE: 'in queue',
    IN_PROGRESS: 'in progress',
    SUCCEEDED: 'succeeded',
    ERROR: 'failed'
  },
  RESOURCE_KEYS: {
    STATE: 'state',
    OPTIONS: 'options',
    LASTOPERATION: 'lastoperation'
  },
  ANNOTATION_KEYS: {
    STATE: 'state',
    OPTIONS: 'options',
  },
  SERVICE_KEYS: {
    ATTRIBUTES: 'attributes',
    PLANS: 'plans'
  },

  PLATFORM: {
    CF: 'cloudfoundry',
    K8S: 'kubernetes'
  },

  PLATFORM_ALIAS_MAPPINGS: {
    'cf': 'cloudfoundry',
    'k8s': 'kubernetes'
  },

  PLATFORM_MANAGER: {
    'cloudfoundry': 'CfPlatformManager',
    'kubernetes': 'K8sPlatformManager'
  },

  AGENT: {
    NAME: 'broker-agent',
    FEATURE: {
      STATE: 'state',
      LIFECYCLE: 'lifecycle',
      CREDENTIALS: 'credentials',
      BACKUP: 'backup',
      RESTORE: 'restore',
      MULTI_TENANCY: 'multi_tenancy'
    }
  },
  STATE: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    DEPRECATED: 'deprecated'
  },
  SERVICE_LIFE_CYCLE: {
    PRE_CREATE: 'PreCreate',
    PRE_DELETE: 'PreDelete',
    PRE_UPDATE: 'PreUpdate',
    PRE_BIND: 'PreBind',
    PRE_UNBIND: 'PreUnbind'
  },
  FILE_PERMISSIONS: {
    RWXR_XR_X: 0o755
  },
  //IaaS SDK config
  SDK_CLIENT: {
    AWS: {
      MAX_RETRIES: 10
    }
  },
  ADD_ON_JOBS: {
    IP_TABLES_MANAGER: 'iptables-manager'
  }
});
