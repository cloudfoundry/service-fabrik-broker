'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const moment = require('moment');
const uuid = require('uuid');
const crypto = require('crypto');
const Readable = require('stream').Readable;
const HttpClient = require('./HttpClient');
const config = require('../config');
const CONST = require('../constants');
const RetryOperation = require('./RetryOperation');
const randomBytes = Promise.promisify(crypto.randomBytes);
const EventLogRiemannClient = require('./EventLogRiemannClient');
const EventLogDomainSocketClient = require('./EventLogDomainSocketClient');
const EventLogDBClient = require('./EventLogDBClient');
const EventLogInterceptor = require('../EventLogInterceptor');
const errors = require('../errors');
const NotImplemented = errors.NotImplemented;
exports.HttpClient = HttpClient;
exports.RetryOperation = RetryOperation;
exports.promiseWhile = promiseWhile;
exports.streamToPromise = streamToPromise;
exports.demux = demux;
exports.parseToken = parseToken;
exports.getTimeAgo = getTimeAgo;
exports.retry = RetryOperation.retry;
exports.encodeBase64 = encodeBase64;
exports.decodeBase64 = decodeBase64;
exports.parseVersion = parseVersion;
exports.compareVersions = compareVersions;
exports.randomBytes = randomBytes;
exports.uuidV4 = uuidV4;
exports.EventLogRiemannClient = EventLogRiemannClient;
exports.EventLogDomainSocketClient = EventLogDomainSocketClient;
exports.EventLogDBClient = EventLogDBClient;
exports.maskSensitiveInfo = maskSensitiveInfo;
exports.deploymentNamesRegExp = deploymentNamesRegExp;
exports.deploymentNameRegExp = deploymentNameRegExp;
exports.getRandomInt = getRandomInt;
exports.getRandomCronForOnceEveryXDays = getRandomCronForOnceEveryXDays;
exports.getRandomCronForOnceEveryXDaysWeekly = getRandomCronForOnceEveryXDaysWeekly;
exports.getRandomCronForEveryDayAtXHoursInterval = getRandomCronForEveryDayAtXHoursInterval;
exports.getCronWithIntervalAndAfterXminute = getCronWithIntervalAndAfterXminute;
exports.isDBConfigured = isDBConfigured;
exports.isFeatureEnabled = isFeatureEnabled;
exports.isServiceFabrikOperation = isServiceFabrikOperation;
exports.isServiceFabrikOperationFinished = isServiceFabrikOperationFinished;
exports.taskIdRegExp = taskIdRegExp;
exports.hasChangesInForbiddenSections = hasChangesInForbiddenSections;
exports.unifyDiffResult = unifyDiffResult;
exports.getBrokerAgentCredsFromManifest = getBrokerAgentCredsFromManifest;
exports.initializeEventListener = initializeEventListener;
exports.buildErrorJson = buildErrorJson;
exports.deploymentLocked = deploymentLocked;
exports.deploymentStaggered = deploymentStaggered;
exports.parseServiceInstanceIdFromDeployment = parseServiceInstanceIdFromDeployment;
exports.verifyFeatureSupport = verifyFeatureSupport;
exports.isRestorePossible = isRestorePossible;
exports.getPlatformManager = getPlatformManager;
exports.getPlatformFromContext = getPlatformFromContext;
exports.pushServicePlanToApiServer = pushServicePlanToApiServer;
exports.getPlanCrdFromConfig = getPlanCrdFromConfig;
exports.getServiceCrdFromConfig = getServiceCrdFromConfig;

function isRestorePossible(plan_id, plan) {
  const settings = plan.manager.settings;
  const restorePredecessors = settings.restore_predecessors || settings.update_predecessors || [];
  const previousPlan = _.find(plan.service.plans, ['id', plan_id]);
  return plan === previousPlan || _.includes(restorePredecessors, previousPlan.id);
}

function verifyFeatureSupport(plan, feature) {
  if (!_.includes(plan.manager.settings.agent.supported_features, feature)) {
    throw new NotImplemented(`Feature '${feature}' not supported`);
  }
}

function streamToPromise(stream, options) {
  const encoding = _.get(options, 'encoding', 'utf8');
  const objectMode = _.get(options, 'objectMode', false);
  if (!(stream instanceof Readable)) {
    stream = new Readable().wrap(stream);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('readable', () => {
      let chunk;
      while ((chunk = stream.read())) {
        if (!objectMode) {
          chunk = chunk.toString(encoding);
        }
        chunks.push(chunk);
      }
    });
    stream.on('end', () => {
      resolve(objectMode ? chunks : chunks.join(''));
    });
    stream.on('error', reject);
  });
}

function getPlatformFromContext(context) {
  let platform = _.get(context, 'platform');
  if (platform === CONST.PLATFORM.SM) {
    return _.get(context, 'origin');
  } else {
    return platform;
  }
}

function initializeEventListener(appConfig, appType) {
  const riemannOptions = _
    .chain({})
    .assign(config.riemann)
    .set('event_type', appConfig.event_type)
    .value();
  const riemannClient = new EventLogRiemannClient(riemannOptions);
  //if events are to be forwarded to monitoring agent via domain socket
  if (appConfig.domain_socket && appConfig.domain_socket.fwd_events) {
    /* jshint unused:false */
    const domainSockOptions = _
      .chain({})
      .set('event_type', appConfig.event_type)
      .set('path', appConfig.domain_socket.path)
      .value();
    const domainSockClient = new EventLogDomainSocketClient(domainSockOptions);
  }
  if (isDBConfigured()) {
    const domainSockClient = new EventLogDBClient({
      event_type: appConfig.event_type
    });
  }
  return EventLogInterceptor.getInstance(appConfig.event_type, appType);
}

function demux(stream, options) {
  options = _.assign({
    tail: Infinity
  }, options);
  const stdout = [];
  const stderr = [];

  function takeRight(size) {
    if (stdout.length > size) {
      stdout.splice(0, stdout.length - size);
    }
    if (stderr.length > size) {
      stderr.splice(0, stderr.length - size);
    }
  }

  return new Promise((resolve, reject) => {
    let header = null;
    let chunk = null;
    let stdoutLength = 0;
    let stderrLength = 0;

    function read() {
      if (!header) {
        header = stream.read(8);
      }
      if (!header) {
        return false;
      }
      chunk = stream.read(header.readUInt32BE(4));
      if (!chunk) {
        return false;
      }
      return true;
    }

    function onreadable() {
      while (read()) {
        switch (header.readUInt8(0)) {
        case 2:
          stderrLength++;
          stderr.push(chunk);
          break;
        default:
          stdoutLength++;
          stdout.push(chunk);
        }
        takeRight(2 * options.tail);
        header = null;
        chunk = null;
      }
    }

    function truncatedMessage(logType, length, total) {
      const separator = _.repeat('#', 68);
      return _
        .chain([
          `The "${logType}" log is truncated.`,
          `Only the last ${length} lines of ${total} are shown here.`
        ])
        .map(line => `# ${_.pad(line, separator.length - 4)} #`)
        .tap(lines => {
          lines.unshift(separator);
          lines.push(separator, '...\n');
        })
        .join('\n')
        .value();
    }

    function onend() {
      takeRight(options.tail);
      if (stdoutLength > stdout.length) {
        stdout.unshift(truncatedMessage('stdout', stdout.length, stdoutLength));
      }
      if (stderrLength > stderr.length) {
        stderr.unshift(truncatedMessage('stderr', stderr.length, stderrLength));

      }
      resolve(_.map([stdout, stderr], lines => _.join(lines, '')));
    }

    function onerror(err) {
      reject(err);
    }

    stream.on('readable', onreadable);
    stream.once('end', onend);
    stream.once('error', onerror);
  });
}

function parseToken(token) {
  return _
    .chain(token)
    .split('.')
    .slice(0, 2)
    .map(decodeBase64)
    .value();
}

function getTimeAgo(date, suffixless) {
  return moment.duration(new Date(date).getTime() - Date.now()).humanize(!suffixless);
}

function encodeBase64(obj) {
  return new Buffer(JSON.stringify(obj), 'utf8').toString('base64');
}

function decodeBase64(str) {
  return JSON.parse(new Buffer(str, 'base64').toString('utf8'));
}

function uuidV4() {
  return randomBytes(16)
    .then(buffer => uuid.v4({
      random: buffer
    }));
}

function compareVersions(left, right) {
  return _
    .chain(parseVersion(left))
    .zip(parseVersion(right))
    .map(_.spread((l, r) => l > r ? 1 : l < r ? -1 : 0))
    .compact()
    .first()
    .value() || 0;
}

function parseVersion(version) {
  return _
    .chain(version)
    .split('.', 3)
    .tap(values => {
      while (values.length < 3) {
        values.push('0');
      }
    })
    .map(_.unary(parseInt))
    .value();
}

function promiseWhile(condition, action) {
  return new Promise((resolve, reject) => {
    const loop = () => condition() ? Promise.try(action).then(loop).catch(reject) : resolve();
    loop();
  });
}

function maskSensitiveInfo(target) {
  const mask = function (target, level) {
    const SENSITIVE_FIELD_NAMES = ['password', 'psswd', 'pwd', 'passwd', 'uri', 'url'];
    //For now only the above fields are marked sensitive. If any additional keys are to be added, expand this list.
    if (level === undefined || level < 0) {
      throw new Error('Level argument cannot be undefined or negative value');
    }
    if (level > 4) {
      //Do not recurse beyond 5 levels in deep objects.
      return target;
    }
    if (!_.isPlainObject(target) && !_.isArray(target)) {
      return;
    }
    if (_.isPlainObject(target)) {
      _.forEach(target, (value, key) => {
        if (_.isPlainObject(target[key]) || _.isArray(target[key])) {
          mask(target[key], level + 1);
        }
        if (typeof value === 'string' &&
          _.includes(SENSITIVE_FIELD_NAMES, key)) {
          target[key] = '*******';
        }
      });
    } else if (_.isArray(target)) {
      _.forEach(target, (value) => {
        if (_.isPlainObject(value) || _.isArray(value)) {
          mask(value, level + 1);
        }
      });
    }
  };
  mask(target, 0);
}

function isDBConfigured() {
  return (_.get(config, 'mongodb.url') !== undefined || _.get(config, 'mongodb.provision.plan_id') !== undefined);
}

function isFeatureEnabled(name) {
  var jobTypes = _.get(config, 'scheduler.job_types');
  var jobTypeList = jobTypes !== undefined ? jobTypes.replace(/\s*/g, '').split(',') : [];
  switch (name) {
  case CONST.FEATURE.SCHEDULED_UPDATE:
    const scheduleUpdateEnabled = _.get(config, 'feature.ServiceInstanceAutoUpdate', false);
    return scheduleUpdateEnabled && isDBConfigured() && jobTypeList.indexOf(name) !== -1;
  case CONST.FEATURE.SCHEDULED_BACKUP:
  case CONST.FEATURE.SCHEDULED_OOB_DEPLOYMENT_BACKUP:
    return isDBConfigured() && jobTypeList.indexOf(name) !== -1;
  default:
    throw new Error(`Unknown feature : ${name}`);
  }
}

// Gereral regex that is used to filter service fabrik deployments
// from all deployments irrespective of subnet
// checks if starts with 'service-fabrik' and ends with guid
function deploymentNamesRegExp() {
  return new RegExp(`^(${CONST.SERVICE_FABRIK_PREFIX}(_[a-z]*)?)-([0-9]{${CONST.NETWORK_SEGMENT_LENGTH}})-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$`);
}

function deploymentNameRegExp(service_subnet) {
  let subnet = service_subnet ? `_${service_subnet}` : '';
  return new RegExp(`^(${CONST.SERVICE_FABRIK_PREFIX}${subnet})-([0-9]{${CONST.NETWORK_SEGMENT_LENGTH}})-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$`);
}

function taskIdRegExp() {
  return new RegExp(`^([0-9a-z-]+)_([0-9]+)$`);
}

function parseServiceInstanceIdFromDeployment(deploymentName) {
  const deploymentNameArray = deploymentNameRegExp().exec(deploymentName);
  if (Array.isArray(deploymentNameArray) && deploymentNameArray.length === 4) {
    return deploymentNameArray[3];
  }
  return deploymentName;
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  const factor = max - min === 1 ? 2 : (max - min);
  //If we want a random of just 2 numbers then the factor must be 2, else it will always return back the lesser of two number always.
  return Math.floor(Math.random() * (factor)) + min;
}

function getRandomCronForEveryDayAtXHoursInterval(everyXHours) {
  assert.ok((everyXHours > 0 && everyXHours <= 24), 'Input hours can be any number between 1 to 24 only');
  const min = exports.getRandomInt(0, 59);
  //referred via exports to aid in stubbing for UT
  let nthHour = exports.getRandomInt(0, everyXHours - 1); //Since we consider from 0
  let hoursApplicable = `${nthHour}`;
  while (nthHour + everyXHours < 24) {
    nthHour = nthHour + everyXHours;
    hoursApplicable = `${hoursApplicable},${nthHour}`;
  }
  return `${min} ${hoursApplicable} * * *`;
}

/**
 * Create a weekly cron
 * @param {Object} options                          - Various options for weekly cron
 * @param {string} [options.start_after_weekday=0]  - bound of the weekday to start the cron (inclusive)
 * @param {string} [options.start_before_weekday=7] - bound of the weekday to end the cron (excluded)
 * @param {string} [options.start_after_hr=0]       - bound of the hour to start the cron
 * @param {string} [options.start_before_hr=23]     - bound of the hour to end the cron
 * @param {string} [options.start_after_min=0]      - bound of the minute to start the cron
 * @param {string} [options.start_before_min=59]    - bound of the minute to end the cron
 */
function getRandomCronForOnceEveryXDaysWeekly(options) {
  const dayInterval = _.get(options, 'day_interval', 0);
  // Get random hour
  const startAfterHour = _.get(options, 'start_after_hr', 0);
  const startBeforeHour = _.get(options, 'start_before_hr', 23);
  const hr = exports.getRandomInt(startAfterHour, startBeforeHour);
  // Get random minute
  const startAfterMin = _.get(options, 'start_after_min', 0);
  const startBeforeMin = _.get(options, 'start_before_min', 59);
  const min = exports.getRandomInt(startAfterMin, startBeforeMin);
  // Get Weekday bounds
  const startAfterWeekday = _.get(options, 'start_after_weekday', 0);
  const startBeforeWeekday = _.get(options, 'start_before_weekday', 7);
  const day = exports.getRandomInt(startAfterWeekday, startBeforeWeekday);
  // Validate the bounds
  assert.ok((startAfterWeekday >= 0 && startAfterWeekday <= 6), 'Start day should be between 0-6');
  assert.ok((startAfterWeekday < startBeforeWeekday), 'start_before_weekday should be greater than start_after_weekday');
  // Get weekday cron based on interval
  let weeklyCron;
  // Default behavior will have dayInterval as 0
  // hence will produce a cron with only one day included
  // 34 11 * * 3
  // which is "At 11:34 on Wednesday."
  // for running multiple times in a week provide a interval between 0 and 4
  // For and interval of 2 and start day of 3, cron:
  // 34 11 * * 3,5
  // the above cron runs at “At 11:34 on Wednesday and Friday.”
  if (dayInterval === 0 || dayInterval >= 4) {
    weeklyCron = `${min} ${hr} * * ${day}`;
  } else {
    const weekdays = _.toString(_.range(startAfterWeekday, startBeforeWeekday, dayInterval));
    weeklyCron = `${min} ${hr} * * ${weekdays}`;
  }
  return weeklyCron;
}

function getRandomCronForOnceEveryXDays(days, options) {
  assert.ok((days > 0 && days < 28), 'Input days can be any number between 1 to 27 only');
  const maxDay = days <= 14 ? days : 28 - days;
  //Considering only 28 days while scheduling to keep things simple.
  const startAfterHour = _.get(options, 'start_after_hr', 0);
  const startBeforeHour = _.get(options, 'start_before_hr', 23);
  const hr = exports.getRandomInt(startAfterHour, startBeforeHour);
  const startAfterMin = _.get(options, 'start_after_min', 0);
  const startBeforeMin = _.get(options, 'start_before_min', 59);
  const min = exports.getRandomInt(startAfterMin, startBeforeMin);
  //referred via exports to aid in stubbing for UT
  const startDay = exports.getRandomInt(1, maxDay);
  let day = startDay;
  let daysApplicable = day;
  while (day + days <= 28 || ((31 - (day + days)) + (startDay - 1) >= days)) {
    //days 29 - 31 are tricky and are not always applicable in every month. So keeping things simple.
    //Second part of OR condition applicable only for shorter duration like once every 2days.
    //NOTE: This function is not perfect in calculating once every xdays in cron.
    //(Not sure if there could be a way to truly randomize and still have valid cron to get once every x days,
    //but this is as good as it gets for now with randomization)
    day = day + days;
    daysApplicable = `${daysApplicable},${day}`;
  }
  return `${min} ${hr} ${daysApplicable} * *`;
}

function getCronWithIntervalAndAfterXminute(interval, afterXminute) {
  afterXminute = afterXminute || 0;
  const currentTime = new Date().getTime();
  const timeAfterXMinute = new Date(currentTime + afterXminute * 60 * 1000);
  const hr = timeAfterXMinute.getHours();
  const min = timeAfterXMinute.getMinutes();

  if (interval === CONST.SCHEDULE.DAILY) {
    interval = `${min} ${hr} * * *`;
  } else if (interval.indexOf('hours') !== -1) {
    const everyXhrs = parseInt(/^[0-9]+/.exec(interval)[0]);
    assert.ok((everyXhrs > 0 && everyXhrs <= 24), 'Input hours can be any number between 1 to 24 only');
    if (everyXhrs === 24) {
      interval = `${min} ${hr} * * *`;
    } else {
      let arrayOfHours = [hr];
      let nthHour = hr;
      while (nthHour + everyXhrs < 24) {
        nthHour = nthHour + everyXhrs;
        arrayOfHours.push(nthHour);
      }
      nthHour = hr;
      while (nthHour - everyXhrs >= 0) {
        nthHour = nthHour - everyXhrs;
        arrayOfHours.push(nthHour);
      }
      //This to handle e.g. '7 hours' where 7 doesn't divide 24
      //then it shoud run in every 7 hours a day including 0
      if (24 % everyXhrs !== 0 && _.indexOf(arrayOfHours, 0) === -1) {
        arrayOfHours.push(0);
      }
      const hoursApplicable = _.sortBy(arrayOfHours).join(',');
      interval = `${min} ${hoursApplicable} * * *`;
    }
  } else {
    throw new assert.AssertionError({
      message: 'interval should \'daily\' or in \'x hours\' format'
    });
  }
  return interval;
}

function isServiceFabrikOperation(params) {
  return _.get(params.parameters, 'service-fabrik-operation') !== undefined;
}

function isServiceFabrikOperationFinished(state) {
  return _.includes([CONST.OPERATION.SUCCEEDED, CONST.OPERATION.FAILED, CONST.OPERATION.ABORTED], state);
}

function hasChangesInForbiddenSections(diff) {
  function findRemovedJob() {
    const jobsRegex = new RegExp('^  jobs'); // this regex is to find the position of jobs section
    const jobsLevelRegex = new RegExp('^  [a-z]+'); // this regex is to find the position of next section at the same level as jobs
    const jobNameRegex = new RegExp('^  [- ] name'); // this regex is to find the position of removal in job name
    const jobStartIndex = _.findIndex(diff, element => jobsRegex.test(element[0]));
    const jobEndIndex = _.findIndex(diff, element => jobsLevelRegex.test(element[0]), jobStartIndex + 1);

    const jobDiff = _.slice(diff, jobStartIndex, jobEndIndex);
    const removedJobName = _.find(jobDiff, element => jobNameRegex.test(element[0]) && _.includes(element[1], 'removed'));
    return removedJobName;
  }

  const forbiddenSections = _
    .chain(diff)
    .map(_.first)
    .filter(line => /^[a-z]\w+:/.test(line))
    .map(line => _.nth(/^([a-z]\w+):/.exec(line), 1))
    .difference([
      'update',
      'releases',
      'tags',
      'addons'
    ])
    .value();

  if (!_.isEmpty(forbiddenSections) && !_.includes(forbiddenSections, 'director_uuid')) {
    const boshLinks = _.filter(diff, element => _.includes(element[0], 'consumes'));
    const forbiddenSectionsDiff = _.filter(diff, element => _.includes(element[0], 'instances') || _.includes(element[0], 'persistent_disk_type'));
    const removedJobName = findRemovedJob();
    const isDiffForbidden = _.isEmpty(boshLinks) && !_.isEmpty(forbiddenSectionsDiff);
    if (isDiffForbidden || removedJobName) {
      throw new errors.Forbidden(`Automatic update not possible. ${!_.isEmpty(forbiddenSectionsDiff) ? 'Detected changes in forbidden sections:' + forbiddenSectionsDiff.join(',') : `Job definition removed: ${removedJobName[0]}`}`);
    }
  }
  return false;
}

function unifyDiffResult(result) {
  const diff = [];
  _.each(result.diff, _.spread((value, type) => {
    switch (type) {
    case 'added':
      diff.push(`+${value}`);
      break;
    case 'removed':
      diff.push(`-${value}`);
      break;
    default:
      diff.push(` ${value}`);
      break;
    }
  }));
  return diff;
}

function getBrokerAgentCredsFromManifest(manifest) {
  var brokerAgentNameRegex = RegExp('broker-agent');
  let authObject;
  _.forEach(manifest.instance_groups, (instanceGroup) => {
    if (authObject) {
      // break forEach
      return false;
    }
    _.forEach(instanceGroup.jobs, (job) => {
      if (brokerAgentNameRegex.test(job.name)) {
        authObject =
          _.chain({})
          .set('username', job.properties.username)
          .set('password', job.properties.password)
          .value();
        // break forEach
        return false;
      }
    });
  });
  return authObject;
}

function buildErrorJson(err, message) {
  return {
    code: err.code,
    status: err.status,
    message: message ? message : err.message
  };
}

function deploymentLocked(err) {
  const response = _.get(err, 'error', {});
  const description = _.get(response, 'description', '');
  return description.indexOf(CONST.OPERATION_TYPE.LOCK) > 0 &&
    _.includes([_.get(err, 'status'), _.get(err, 'statusCode'), _.get(response, 'status')], CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);
}


function deploymentStaggered(err) {
  const response = _.get(err, 'error', {});
  const description = _.get(response, 'description', '');
  return description.indexOf(CONST.FABRIK_OPERATION_STAGGERED) > 0 && description.indexOf(CONST.FABRIK_OPERATION_COUNT_EXCEEDED) > 0;
}

function getPlatformManager(context) {
  const BasePlatformManager = require('../../platform-managers/BasePlatformManager');
  let platform = getPlatformFromContext(context);
  const PlatformManager = (platform && CONST.PLATFORM_MANAGER[platform]) ? require(`../../platform-managers/${CONST.PLATFORM_MANAGER[platform]}`) : ((platform && CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]) ? require(`../../platform-managers/${CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]}`) : undefined);
  if (PlatformManager === undefined) {
    return new BasePlatformManager(platform);
  } else {
    return new PlatformManager(platform);
  }
}

function getPlanCrdFromConfig(plan, service) {
  assert.ok(plan.name, 'plan.name is required to generate plan crd');
  assert.ok(plan.id, 'plan.id is required to generate plan crd');
  assert.ok(plan.description, 'plan.description is required to generate plan crd');

  let planCRD = {
    apiVersion: 'osb.servicefabrik.io/v1alpha1',
    kind: 'SFPlan',
    metadata: {
      name: plan.id,
      labels: {
        'controller-tools.k8s.io': '1.0',
        serviceId: service.id
      }
    },
    spec: {
      name: plan.name,
      id: plan.id,
      serviceId: service.id,
      description: plan.description,
      free: plan.free ? true : service.free ? true : false,
      bindable: plan.bindable ? plan.bindable : service.bindable ? service.bindable : false,
      planUpdatable: plan.bindable ? true : false,
      templates: plan.templates ? plan.templates : []
    }
  };
  if (plan.metadata) {
    planCRD.spec.metadata = plan.metadata;
  }
  if (plan.manager) {
    planCRD.spec.manager = plan.manager;
  }
  if (plan.context) {
    planCRD.spec.context = plan.context;
  }
  if (plan.actions) {
    planCRD.spec.actions = plan.actions;
  }
  if (plan.async_ops_supporting_parallel_sync_ops) {
    planCRD.spec.asyncOpsSupportingParallelSyncOps = plan.async_ops_supporting_parallel_sync_ops;
  }
  return planCRD;
}

function getServiceCrdFromConfig(service) {
  assert.ok(service.name, 'service.name is required to generate plan crd');
  assert.ok(service.id, 'service.id is required to generate plan crd');
  assert.ok(service.description, 'service.description is required to generate plan crd');
  assert.ok(service.bindable, 'service.bindable is required to generate plan crd');

  let serviceCRD = {
    apiVersion: 'osb.servicefabrik.io/v1alpha1',
    kind: 'SFService',
    metadata: {
      name: service.id,
      labels: {
        'controller-tools.k8s.io': '1.0',
        serviceId: service.id
      }
    },
    spec: {
      name: service.name,
      id: service.id,
      bindable: service.bindable,
      description: service.description
    }
  };
  if (service.metadata) {
    serviceCRD.spec.metadata = service.metadata;
  }
  if (service.tags) {
    serviceCRD.spec.tags = service.tags;
  }
  if (service.dashboard_client) {
    serviceCRD.spec.dashboardClient = service.dashboard_client;
  }
  if (service.plan_updateable) {
    serviceCRD.spec.planUpdateable = service.plan_updateable;
  }
  if (service.supported_platform) {
    serviceCRD.spec.supportedPlatform = service.supported_platform;
  }
  if (service.actions) {
    serviceCRD.spec.actions = service.actions;
  }
  if (service.backup_interval) {
    serviceCRD.spec.backupInterval = service.backup_interval;
  }
  if (service.pitr) {
    serviceCRD.spec.pitr = service.pitr;
  }
  return serviceCRD;
}

function pushServicePlanToApiServer() {
  if (!config.apiserver.isServiceDefinitionAvailableOnApiserver) {
    if (!config.apiserver.isServiceDefinitionAvailableOnApiserver) {
      const eventmesh = require('../../data-access-layer/eventmesh');
      let promiseList = [];
      _.each(config.services, service => {
        const servicePromise = eventmesh.apiServerClient.createOrUpdateServicePlan(getServiceCrdFromConfig(service));
        promiseList.push(servicePromise);
        _.each(service.plans, plan => {
          const planPromise = eventmesh.apiServerClient.createOrUpdateServicePlan(getPlanCrdFromConfig(plan, service));
          promiseList.push(planPromise);
        });
      });
      return Promise.all(promiseList);
    }
  }
}