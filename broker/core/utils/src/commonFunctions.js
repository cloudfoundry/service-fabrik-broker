'use strict';

const _ = require('lodash');
const assert = require('assert');
const uuid = require('uuid');
const crypto = require('crypto');
const Promise = require('bluebird');
const moment = require('moment');
const randomBytes = Promise.promisify(crypto.randomBytes);
const Readable = require('stream').Readable;
const config = require('@sf/app-config');
const RetryOperation = require('./RetryOperation');
const CONST = require('./commonVariables');
const {
  NotImplemented,
  Forbidden
} = require('./errors');

exports.retry = RetryOperation.retry;
exports.compareVersions = compareVersions;
exports.encodeBase64 = encodeBase64;
exports.decodeBase64 = decodeBase64;
exports.uuidV4 = uuidV4;
exports.sha224Sum = sha224Sum;
exports.isValidKubernetesName = isValidKubernetesName;
exports.isValidKubernetesLabelValue = isValidKubernetesLabelValue;
exports.isServiceFabrikOperation = isServiceFabrikOperation;
exports.streamToPromise = streamToPromise;
exports.isFeatureEnabled = isFeatureEnabled;
exports.verifyFeatureSupport = verifyFeatureSupport;
exports.isRestorePossible = isRestorePossible;
exports.unifyDiffResult = unifyDiffResult;
exports.getRandomInt = getRandomInt;
exports.isCronSafe = isCronSafe;
exports.getRandomCronForEveryDayAtXHoursInterval = getRandomCronForEveryDayAtXHoursInterval;
exports.getCronWithIntervalAndAfterXminute = getCronWithIntervalAndAfterXminute;
exports.parseServiceInstanceIdFromDeployment = parseServiceInstanceIdFromDeployment;
exports.taskIdRegExp = taskIdRegExp;
exports.deploymentNameRegExp = deploymentNameRegExp;
exports.isServiceFabrikOperationFinished = isServiceFabrikOperationFinished;
exports.maskSensitiveInfo = maskSensitiveInfo;
exports.deploymentStaggered = deploymentStaggered;
exports.deploymentLocked = deploymentLocked;
exports.hasChangesInForbiddenSections = hasChangesInForbiddenSections;
exports.getRandomCronForOnceEveryXDaysWeekly = getRandomCronForOnceEveryXDaysWeekly;
exports.buildErrorJson = buildErrorJson;
exports.sleep = sleep;
exports.parseToken = parseToken;
exports.getPlatformFromContext = getPlatformFromContext;
exports.randomBytes = randomBytes;
exports.isDBConfigured = isDBConfigured;
exports.getDefaultErrorMsg = getDefaultErrorMsg;
exports.getTimeAgo = getTimeAgo;
exports.demux = demux;
exports.getBrokerAgentCredsFromManifest = getBrokerAgentCredsFromManifest;
exports.getCronAfterXMinuteFromNow = getCronAfterXMinuteFromNow;
exports.isBrokerBoshDeployment = isBrokerBoshDeployment;

function isBrokerBoshDeployment() {
  return !process.env.POD_NAMESPACE;
}

function parseToken(token) {
  return _
    .chain(token)
    .split('.')
    .slice(0, 2)
    .map(decodeBase64)
    .value();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isServiceFabrikOperationFinished(state) {
  return _.includes([CONST.OPERATION.SUCCEEDED, CONST.OPERATION.FAILED, CONST.OPERATION.ABORTED], state);
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

function compareVersions(left, right) {
  return _
    .chain(parseVersion(left))
    .zip(parseVersion(right))
    .map(_.spread((l, r) => l > r ? 1 : l < r ? -1 : 0))
    .compact()
    .first()
    .value() || 0;
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

function sha224Sum(str) {
  const hash = crypto.createHash('sha224');
  hash.update(str, 'utf8');
  return hash.digest('hex');
}

function isValidKubernetesName(str) {
  // "a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters,
  // '-' or '.', and must start and end with an alphanumeric character"
  const dns1123LabelFmt = '[a-z0-9]([-a-z0-9]*[a-z0-9])?';

  const dns1123SubdomainFmt = dns1123LabelFmt + '(\\.' + dns1123LabelFmt + ')*';

  // DNS1123SubdomainMaxLength is a subdomain's max length in DNS (RFC 1123)
  const DNS1123SubdomainMaxLength = 253;

  if (str.length <= 0 || str.length > DNS1123SubdomainMaxLength) {
    return false;
  }

  const dns1123SubdomainRegexp = new RegExp('^' + dns1123SubdomainFmt + '$');
  return dns1123SubdomainRegexp.test(str);
}

// isValidKubernetesLabelValue tests whether the value passed is a valid label value.
// a valid label must be an empty string or consist of alphanumeric characters, '-', '_' 
// or '.', and must start and end with an alphanumeric character
function isValidKubernetesLabelValue(value) {
  const qnameCharFmt = '[A-Za-z0-9]';
  const qnameExtCharFmt = '[-A-Za-z0-9_.]';
  const qualifiedNameFmt = '(' + qnameCharFmt + qnameExtCharFmt + '*)?' + qnameCharFmt;
  const labelValueFmt = '(' + qualifiedNameFmt + ')?';

  // LabelValueMaxLength is a label's max length
  const LabelValueMaxLength = 63;

  const labelValueRegexp = new RegExp('^' + labelValueFmt + '$');

  if (value.length > LabelValueMaxLength) {
    return false;
  }
  return labelValueRegexp.test(value);
}

function isServiceFabrikOperation(params) {
  return _.get(params.parameters, 'service-fabrik-operation') !== undefined;
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

function isDBConfigured() {
  return (_.get(config, 'mongodb.url') !== undefined || _.get(config, 'mongodb.provision.plan_id') !== undefined);
}

function isFeatureEnabled(name) {
  var jobTypes = _.get(config, 'scheduler.job_types'); // eslint-disable-line no-var
  var jobTypeList = jobTypes !== undefined ? jobTypes.replace(/\s*/g, '').split(',') : []; // eslint-disable-line no-var
  switch (name) {
    case CONST.FEATURE.SCHEDULED_UPDATE:
      return _.get(config, 'feature.ServiceInstanceAutoUpdate', false) && isDBConfigured() && jobTypeList.indexOf(name) !== -1;
    case CONST.FEATURE.SCHEDULED_BACKUP:
    case CONST.FEATURE.SCHEDULED_OOB_DEPLOYMENT_BACKUP:
      return isDBConfigured() && jobTypeList.indexOf(name) !== -1;
    default:
      throw new Error(`Unknown feature : ${name}`);
  }
}

function verifyFeatureSupport(plan, feature) {
  if (!_.includes(plan.manager.settings.agent.supported_features, feature)) {
    throw new NotImplemented(`Feature '${feature}' not supported`);
  }
}

function isRestorePossible(plan_id, plan) {
  const settings = plan.manager.settings;
  const restorePredecessors = settings.restore_predecessors || settings.update_predecessors || [];
  const previousPlan = _.find(plan.service.plans, ['id', plan_id]);
  return plan === previousPlan || _.includes(restorePredecessors, previousPlan.id);
}

function getPlatformFromContext(context) {
  let platform = _.get(context, 'platform');
  if (platform === CONST.PLATFORM.SM) {
    return _.get(context, 'origin');
  } else {
    return platform;
  }
}

function unifyDiffResult(result, ignoreTags) {
  const diff = [];
  let validDeploymentSection = true;
  _.each(result.diff, _.spread((value, type) => {

    if (_.includes(value, 'tags:') && ignoreTags) {
      validDeploymentSection = false;
    } else if (!validDeploymentSection && _.findIndex(CONST.BOSH_DEPLOYMENT_MANIFEST_SECTIONS, section => {
      return _.includes(value, section);
    }) != -1) {
      validDeploymentSection = true;
    }

    if (validDeploymentSection) {
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
    }
  }));
  return diff;
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  const factor = max - min === 1 ? 2 : (max - min);
  // If we want a random of just 2 numbers then the factor must be 2, else it will always return back the lesser of two number always.
  return Math.floor(Math.random() * (factor)) + min;
}

// valid format: sec|* (optional) min|* hour|* day|* month|* day of week|*
function isCronSafe(interval) {
  const parts = interval.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return false;
  }
  for(let i = 0; i < parts.length; i++) {
    if (parts[i] != '*') {
      return true;
    }
  }
  return false;
}

function getRandomCronForEveryDayAtXHoursInterval(everyXHours) {
  assert.ok((everyXHours > 0 && everyXHours <= 24), 'Input hours can be any number between 1 to 24 only');
  const min = exports.getRandomInt(0, 59);
  // referred via exports to aid in stubbing for UT
  let nthHour = exports.getRandomInt(0, everyXHours - 1); // Since we consider from 0
  let hoursApplicable = `${nthHour}`;
  while (nthHour + everyXHours < 24) {
    nthHour = nthHour + everyXHours;
    hoursApplicable = `${hoursApplicable},${nthHour}`;
  }
  return `${min} ${hoursApplicable} * * *`;
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
      // This to handle e.g. '7 hours' where 7 doesn't divide 24
      // then it shoud run in every 7 hours a day including 0
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

function deploymentNameRegExp(service_subnet) {
  let subnet = service_subnet ? `_${service_subnet}` : '';
  return new RegExp(`^(${CONST.SERVICE_FABRIK_PREFIX}${subnet})-([0-9]{${CONST.NETWORK_SEGMENT_LENGTH}})-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$`);
}


function taskIdRegExp() {
  return new RegExp('^([0-9a-z-]+)_([0-9]+)$');
}

function parseServiceInstanceIdFromDeployment(deploymentName) {
  const deploymentNameArray = deploymentNameRegExp().exec(deploymentName);
  if (Array.isArray(deploymentNameArray) && deploymentNameArray.length === 4) {
    return deploymentNameArray[3];
  }
  return deploymentName;
}

function maskSensitiveInfo(target) {
  const mask = function (target, level) {
    const SENSITIVE_FIELD_NAMES = ['password', 'psswd', 'pwd', 'passwd', 'uri', 'url'];
    // For now only the above fields are marked sensitive. If any additional keys are to be added, expand this list.
    if (level === undefined || level < 0) {
      throw new Error('Level argument cannot be undefined or negative value');
    }
    if (level > 4) {
      // Do not recurse beyond 5 levels in deep objects.
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
      _.forEach(target, value => {
        if (_.isPlainObject(value) || _.isArray(value)) {
          mask(value, level + 1);
        }
      });
    }
  };
  mask(target, 0);
}

function deploymentStaggered(err) {
  const response = _.get(err, 'error', {});
  const description = _.get(response, 'description', '');
  return description.indexOf(CONST.FABRIK_OPERATION_STAGGERED) > 0 && description.indexOf(CONST.FABRIK_OPERATION_COUNT_EXCEEDED) > 0;
}

function deploymentLocked(err) {
  const response = _.get(err, 'error', {});
  const description = _.get(response, 'description', '');
  return description.indexOf(CONST.OPERATION_TYPE.LOCK) > 0 &&
    _.includes([_.get(err, 'status'), _.get(err, 'statusCode'), _.get(response, 'status')], CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);
}

function hasChangesInForbiddenSections(diff) {
  function findRemovedJob() {
    const jobsRegex = new RegExp('^ {2}jobs'); // this regex is to find the position of jobs section
    const jobsLevelRegex = new RegExp('^ {2}[a-z]+'); // this regex is to find the position of next section at the same level as jobs
    const jobNameRegex = new RegExp('^ {2}[- ] name'); // this regex is to find the position of removal in job name
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
      throw new Forbidden(`Automatic update not possible. ${!_.isEmpty(forbiddenSectionsDiff) ? 'Detected changes in forbidden sections:' + forbiddenSectionsDiff.join(',') : `Job definition removed: ${removedJobName[0]}`}`);
    }
  }
  return false;
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

function buildErrorJson(err, message) {
  return {
    code: err.code,
    status: err.status,
    message: message ? message : err.message
  };
}

function getDefaultErrorMsg(err) {
  return `Service Broker Error, status code: ${err.code ? err.code : CONST.HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR}, error code: ${err.statusCode ? err.statusCode : CONST.ERR_STATUS_CODES.BROKER.DEFAULT}, message: ${err.message}`;
}

function getTimeAgo(date, suffixless) {
  return moment.duration(new Date(date).getTime() - Date.now()).humanize(!suffixless);
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

function getBrokerAgentCredsFromManifest(manifest) {
  var brokerAgentNameRegex = RegExp('broker-agent'); // eslint-disable-line no-var
  let authObject;
  _.forEach(manifest.instance_groups, instanceGroup => {
    if (authObject) {
      // break forEach
      return false;
    }
    _.forEach(instanceGroup.jobs, job => {
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

function getCronAfterXMinuteFromNow(afterXminute) {
  afterXminute = afterXminute || 3;
  const currentTime = new Date().getTime();
  const timeAfterXMinute = new Date(currentTime + afterXminute * 60 * 1000);
  const hr = timeAfterXMinute.getHours();
  const min = timeAfterXMinute.getMinutes();
  const date = timeAfterXMinute.getDate();
  const month = timeAfterXMinute.getMonth();
  const interval = `${min} ${hr} ${date} ${month} *`;
  return interval;
}
