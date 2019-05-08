'use strict';

module.exports = Object.freeze({
  NETWORK_SEGMENT_LENGTH: 4,
  BOSH_POLL_MAX_ATTEMPTS: 3,
  BOSH_DEPLOYMENT_ACTIONS: {
    STOPPED: 'stopped',
    STARTED: 'started',
    DETACHED: 'detached',
    RESTART: 'restart',
    RECREATE: 'recreate'
  },
  BOSH_RATE_LIMITS: {
    BOSH_CONTEXT_ID: 'X-Bosh-Context-Id',
    BOSH_FABRIK_OP: 'Fabrik::Operation::',
    BOSH_FABRIK_OP_AUTO: 'Fabrik::Operation::Auto',
    BOSH_FABRIK_OP_MONGO: 'Fabrik::Operation::MongoDB',
    BOSH_PROCESSING: 'processing',
    BOSH_CANCELLING: 'cancelling'
  },
  BOSH_DEPLOYMENT_MANIFEST_SECTIONS: [
    'features',
    'releases',
    'stemcells',
    'update',
    'instance_groups',
    'addons',
    'properties',
    'variables',
    'tags'
  ],
  FABRIK_SCHEDULED_OPERATION: 'scheduled',
  FABRIK_OPERATION_STAGGERED: 'staggered',
  FABRIK_OPERATION_COUNT_EXCEEDED: 'operation count exceeded',
  UNCATEGORIZED: 'uncategorized',
  DEPLOYMENT_LOCK_NAME: '_LOCK_',
  SERVICE_FABRIK_PREFIX: 'service-fabrik',
  PLATFORM_CONTEXT_KEY: 'platform-context',
  NOT_APPLICABLE: 'NA',
  FINISHED_JOBS_RETENTION_DURATION_DAYS: 14,
  BACKUP_REAPER_BUFFER_DURATION_DAYS: 15,
  EVENT_LOG_RIEMANN_CLIENT: {
    MAX_QUEUE_SIZE: 100,
    MAX_SEND_RETRIES: 2
  },
  EVENT_LOG_RIEMANN_CLIENT_STATUS: {
    INITIALIZING: 'initializing',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected'
  },
  EVENT_LOG_INTERCEPTOR: {
    UPDATE_EVENT: 'update_instance'
  },
  EVENTMESH_POLLER_DELAY: 200,
  UNLOCK_RESOURCE_POLLER_INTERVAL: 3000,
  RESTORE_OPERATION: {
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    ABORTED: 'aborted',
    PROCESSING: 'processing'
  },
  BACKUP_OPERATION: {
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    ABORTED: 'aborted',
    PROCESSING: 'processing'
  },
  OSB_OPERATION: {
    OSB_SYNC_OPERATION_TIMEOUT_IN_SEC: 55 // in sec
  },
  DIRECTOR_RESOURCE_POLLER_INTERVAL: 50000, // in ms
  POLLER_RELAXATION_TIME: 5000, // in ms
  PROCESSING_REQUEST_BY_MANAGER_TIMEOUT: 300000, // 5 minutes
  OPERATION: {
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    ABORT: 'abort',
    ABORTED: 'aborted',
    IN_PROGRESS: 'in progress',
    ABORTING: 'aborting'
  },
  SF_BROKER_API_VERSION_MIN: '2.12',
  OPERATION_TYPE: {
    LIFECYCLE: ['create', 'update', 'delete'],
    BACKUP: 'backup',
    RESTORE: 'restore',
    UNLOCK: 'unlock',
    LOCK: '__Locked__',
    CREATE: 'create',
    UPDATE: 'update',
    BIND: 'bind',
    UNBIND: 'unbind',
    DELETE: 'delete',
    SERVICE_FLOW: 'serviceflow'
  },
  URL: {
    backup: '/api/v1/service_instances/:instance_id/backup',
    restore: '/api/v1/service_instances/:instance_id/restore',
    backup_by_guid: '/api/v1/backups/:backup_guid',
    instance: '/:platform(cf|k8s|sm)/v2/service_instances/:instance_id',
    METERING_AUTH: '/oauth/token',
    METERING_USAGE: '/usage/v2/usage/documents'
  },
  INSTANCE_TYPE: {
    DIRECTOR: 'director',
    DOCKER: 'docker',
    VIRTUAL_HOST: 'virtual_host'
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
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    FOUND: 302,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    NOT_ACCEPTABLE: 406,
    CONFLICT: 409,
    GONE: 410,
    PRECONDITION_FAILED: 412,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER_ERROR: 500,
    TIMEOUT: 504
  },
  JOB_NAME_ATTRIB: '_n_a_m_e_',
  METERING_ARCHIVE_JOB_FILE_PREFIX: 'MeteringArchive-',
  ARCHIVE_METERED_EVENTS_RUN_THRESHOLD: 500,
  METERING_ARCHIVE_ROOT_FOLDER: 'MeteringArchive',
  JOB: {
    // Define names of scheduled JOBS
    SCHEDULED_BACKUP: 'ScheduledBackup',
    SERVICE_FABRIK_BACKUP: 'ServiceFabrikBackup',
    SCHEDULED_OOB_DEPLOYMENT_BACKUP: 'ScheduledOobDeploymentBackup',
    OPERATION_STATUS_POLLER: 'OperationStatusPoller',
    BLUEPRINT_JOB: 'BluePrintJob',
    BACKUP_REAPER: 'BackupReaper',
    SERVICE_INSTANCE_UPDATE: 'ServiceInstanceAutoUpdate',
    DB_COLLECTION_REAPER: 'DbCollectionReaper',
    METER_INSTANCE: 'MeterInstance',
    ARCHIVE_METERED_EVENTS: 'ArchiveMeteredEvents'
  },
  JOB_RUN_STATUS_CODE: {
    SUCCEEDED: '0'
  },
  JOB_SCHEDULER: {
    WORKER_CREATE_DELAY: 60000,
    SHUTDOWN_WAIT_TIME: 5000
  },
  BACKUP: {
    RESCHEDULE_BACKUP_DELAY_AFTER_RESTORE: 3,
    TYPE: {
      ONLINE: 'online'
    },
    TRIGGER: {
      SCHEDULED: 'scheduled',
      ON_DEMAND: 'on-demand',
      MANUAL: 'manual' // This is actually scheduled backup via existing cron jobs. Could be removed 14 days after the current solution goes live.
    }
  },
  SCHEDULE: {
    DAILY: 'daily',
    RANDOM: 'random'
  },
  SCHEDULE_INTERVAL: {
    HUMAN_INTERVAL: 'human-readable-interval',
    CRON_EXPRESSION: 'cron_expression'
  },
  CONFIG: {
    DISABLE_SCHEDULED_UPDATE_CONFIG_PREFIX: 'disable_scheduled_update_',
    RESOURCE_NAME: 'sfconfig',
    DISABLE_BOSH_BASED_RESTORE_PREFIX: 'disable_bosh_based_restore_'
  },
  DB_MODEL: {
    // Define all DB Model names
    JOB: 'JobDetail',
    JOB_RUN_DETAIL: 'JobRunDetail',
    MAINTENANCE_DETAIL: 'MaintenanceDetail',
    EVENT_DETAIL: 'EventDetail'
  },
  // Topic naming convention: {GROUP}.{EVENT_NAME}
  // Reasoning: pubsub module allow for dotted notation of event names and one can subscribe to all events even at group level
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
  // BELOW UUIDs are taken from MongoDB Manifest for v3.0-dedicated-xsmall
  FABRIK_INTERNAL_MONGO_DB: {
    SERVICE_ID: '3c266123-8e6e-4034-a2aa-e48e13fbf893',
    PLAN_ID: '2fff2c4d-7c31-4ed7-b505-0aeafbd8c0e2',
    ORG_ID: 'FABDEC11-FABD-FABD-FABD-FABDECFABDEC', // Random valid UUID string made from FABDEC phonotically similar to FABRIK
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
    INTERNAL_ERROR: 4,
    UNCAUGHT_FATAL_EXCEPTION: 1 // https://github.com/nodejs/node-v0.x-archive/blob/master/doc/api/process.markdown#exit-codes
    // Error codes should always be readable strings. However few error codes (used as process exit codes) must be int.
    // Guideline : Only in cases where it is mandatory to have int, error codes should be so else they must always be Strings.
  },
  ERR_STATUS_CODES: {
    BROKER: {
      DEFAULT: 10001
    },
    BOSH: {
      BAD_FORMAT: 20002,
      DIRECTOR_UNAVAILABLE: 20003,
      DEPLOYMENT_NOT_FOUND: 20004,
      DEPLOYMENT_ALREADY_EXISTS: 20009
    },
    DOCKER: {
      DOCKER_UNAVAILABLE: 30003
    },
    CF: {
      DEFAULT: 40001
    },
    STORE: {
      DEFAULT: 50001
    }
  },
  BOSH_ERR_CODES: {
    DEPLOYMENT_NOT_FOUND: 70000
  },
  // OOB Deployments
  FABRIK_OUT_OF_BAND_DEPLOYMENTS: {
    ROOT_FOLDER_NAME: 'OOB_DEPLOYMENTS',
    DEFAULT_DELETE_DELAY: 1000
  },
  // BOSH Directors
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
  APISERVER: {
    OPERATION_TIMEOUT_IN_SECS: 175,
    HOLD_PROCESSING_LOCK: 'HOLD_PROCESSING_LOCK',
    RETRY_DELAY: 2000,
    MAX_RETRY_UNLOCK: 3,
    LOCK_TYPE: {
      WRITE: 'WRITE',
      READ: 'READ'
    },
    DEFAULT_LOCK_TTL: 86400, // 1 days in sec
    WATCHER_ERROR_DELAY: 30000, // in ms (30 seconds)
    WATCHER_REFRESH_INTERVAL: 60000, // in ms ( 1 minute )
    POLLER_WATCHER_REFRESH_INTERVAL: 120000, // // in ms should be greater than DIRECTOR_RESOURCE_POLLER_INTERVAL
    WATCH_TIMEOUT: 600, // in sec (10 minutes)
    VERSION: '1.9',
    DEFAULT_NAMESPACE: 'default',
    NAMESPACE_OBJECT: 'Namespace',
    NAMESPACE_API_VERSION: 'v1',
    SECRET_API_VERSION: 'v1',
    API_VERSION: 'v1alpha1',
    CRD_RESOURCE_GROUP: 'apiextensions.k8s.io',
    PATCH_CONTENT_TYPE: 'application/merge-patch+json',
    CONFIG_MAP: {
      API_VERSION: 'v1',
      RESOURCE_TYPE: 'configmaps',
      RESOURCE_KIND: 'ConfigMap'
    },
    RESOURCE_GROUPS: {
      INTEROPERATOR: 'osb.servicefabrik.io',
      LOCK: 'lock.servicefabrik.io',
      DEPLOYMENT: 'deployment.servicefabrik.io',
      BIND: 'bind.servicefabrik.io',
      BACKUP: 'backup.servicefabrik.io',
      RESTORE: 'backup.servicefabrik.io',
      SERVICE_FLOW: 'serviceflow.servicefabrik.io',
      INSTANCE: 'instance.servicefabrik.io'
    },
    RESOURCE_TYPES: {
      INTEROPERATOR_SERVICEINSTANCES: 'sfserviceinstances',
      INTEROPERATOR_SERVICEBINDINGS: 'sfservicebindings',
      INTEROPERATOR_SERVICES: 'sfservices',
      INTEROPERATOR_PLANS: 'sfplans',
      DEPLOYMENT_LOCKS: 'deploymentlocks',
      DIRECTOR: 'directors',
      DOCKER: 'dockers',
      VIRTUALHOST: 'virtualhosts',
      POSTGRESQL_MT: 'postgresqlmts',
      DIRECTOR_BIND: 'directorbinds',
      DOCKER_BIND: 'dockerbinds',
      VIRTUALHOST_BIND: 'virtualhostbinds',
      POSTGRESQL_MT_BIND: 'postgresqlmtbinds',
      DEFAULT_BACKUP: 'defaultbackups',
      DEFAULT_RESTORE: 'defaultrestores',
      DEFAULT_BOSH_RESTORE: 'defaultboshrestores',
      SERIAL_SERVICE_FLOW: 'serialserviceflows',
      SFEVENT: 'sfevents',
      TASK: 'tasks'
    },
    RESOURCE_STATE: {
      IN_QUEUE: 'in_queue',
      IN_PROGRESS: 'in_progress',
      WAITING: 'waiting',
      DELETE: 'delete',
      DELETED: 'deleted',
      SUCCEEDED: 'succeeded',
      FAILED: 'failed',
      DELETE_FAILED: 'delete_failed',
      ABORT: 'abort',
      ABORTING: 'aborting',
      ABORTED: 'aborted',
      UPDATE: 'update',
      LOCKED: 'locked',
      UNLOCKED: 'unlocked'
    },
    FINALIZERS: {
      BROKER: 'broker.servicefabrik.io'
    },
    TASK_TYPE: {
      SERVICE_INSTANCE_BACKUP: 'ServiceInstanceBackupTask',
      SERVICE_INSTANCE_UPDATE: 'ServiceInstanceUpdateTask',
      BLUEPRINT: 'BlueprintTask'
    },
    TASK_STATE: {
      DONE: 'DONE',
      RELAYED: 'RELAYED',
      FLOW_COMPLETE: 'FLOW_COMPLETE'
    },
    RESOURCE_KEYS: {
      STATE: 'state',
      OPTIONS: 'options',
      LASTOPERATION: 'lastoperation'
    },
    WRITE_OPERATIONS: ['create', 'update', 'delete', 'restore', 'update_serviceflow'],
    READ_OPERATIONS: ['backup']
  },
  METER_STATE: {
    TO_BE_METERED: 'TO_BE_METERED',
    METERED: 'METERED',
    EXCLUDED: 'EXCLUDED',
    FAILED: 'FAILED'
  },
  SERVICE_KEYS: {
    ATTRIBUTES: 'attributes',
    PLANS: 'plans'
  },
  ENCRYPTION: {
    AES_256_ALGORITHM: 'aes-256-ctr',
    INPUT_ENCODING: 'utf8',
    OUTPUT_ENCODING: 'hex'
  },
  PLATFORM: {
    CF: 'cloudfoundry',
    K8S: 'kubernetes',
    SM: 'sapcp'
  },

  PLATFORM_ALIAS_MAPPINGS: {
    'cf': 'cloudfoundry',
    'k8s': 'kubernetes',
    'sm': 'sapcp'
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
    },
    OPERATION_TIMEOUT_IN_MILLIS: 25000
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
  // IaaS SDK config
  SDK_CLIENT: {
    AWS: {
      MAX_RETRIES: 10
    }
  },
  ADD_ON_JOBS: {
    IP_TABLES_MANAGER: 'iptables-manager'
  },
  API_SERVER: {
    WATCH_EVENT: {
      ADDED: 'ADDED',
      MODIFIED: 'MODIFIED',
      DELETED: 'DELETED'
    }
  },
  NETWORK_MANAGER: {
    NETWORK_ID: 'SF'
  },
  MULTITENANCY_SERVICE_TYPE: {
    MULTITENANCYSERVICE: 'multitenancyService',
    MULTITENANCYBINDSERVICE: 'multitenancyBindService'
  },
  SERVICE_FLOW: {
    DEFINITION_FILE_NAME: 'serial-serviceflow-definition.yml',
    TYPE: {
      BLUEPRINT_SERVICEFLOW: 'blueprint_serviceflow',
      UPGRADE_MULTI_AZ: 'upgrade_to_multi_az',
      DOWNGRADE_TO_SINGLE_AZ: 'downgrade_to_single_az',
      MAJOR_VERSION_UPGRADE: 'major_version_upgrade'
    }
  },
  DOCKER_HOST_CONFIG: {
    PIDS_LIMIT: 150
  },
  CF_SECURITY_GROUP: {
    MAX_RETRIES: 4,
    RETRY_DELAY: 1000
  },
  SYSTEM_ERRORS: ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'],
  INTERNAL: 'internal',
  ALL: 'all',
  ANY: 'any',
  DISABLED: 'disabled',
  REGEX_PATTERN: {
    URL: /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/
  },
  ALI_CLIENT:{
    ECS:{
      DOMAIN: 'https://ecs.aliyuncs.com',
      API_VERSION: '2014-05-26',
      REQ_TIMEOUT: 20000, // 20 seconds
      AVAILABILITY_POLLER_DELAY: 1000, // 1sec
      AVAILABILITY_POLLER_TIMEOUT_IN_SEC: 3600 // 60 minutes
    }
  }
});
