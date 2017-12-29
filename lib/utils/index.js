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
const ServiceBrokerClient = require('./ServiceBrokerClient');
const errors = require('../errors');
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
exports.serviceBrokerClient = new ServiceBrokerClient();
exports.maskSensitiveInfo = maskSensitiveInfo;
exports.deploymentNamesRegExp = deploymentNamesRegExp;
exports.deploymentNameRegExp = deploymentNameRegExp;
exports.getRandomInt = getRandomInt;
exports.getRandomCronForOnceEveryXDays = getRandomCronForOnceEveryXDays;
exports.isDBConfigured = isDBConfigured;
exports.isFeatureEnabled = isFeatureEnabled;
exports.isServiceFabrikOperation = isServiceFabrikOperation;
exports.isServiceFabrikOperationFinished = isServiceFabrikOperationFinished;
exports.taskIdRegExp = taskIdRegExp;
exports.hasChangesInForbiddenSections = hasChangesInForbiddenSections;
exports.unifyDiffResult = unifyDiffResult;

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
  return new RegExp(`^(${config.directors[0].prefix}${subnet})-([0-9]{${CONST.NETWORK_SEGMENT_LENGTH}})-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$`);
}

function taskIdRegExp() {
  return new RegExp(`^([0-9a-z-]+)_([0-9]+)$`);
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  const factor = max - min === 1 ? 2 : (max - min);
  //If we want a random of just 2 numbers then the factor must be 2, else it will always return back the lesser of two number always.
  return Math.floor(Math.random() * (factor)) + min;
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
    const forbiddenSectionsDiff = _.filter(diff, element => _.includes(element[0], 'instances') || _.includes(element[0], 'persistent_disk_type'));
    const removedJobName = findRemovedJob();
    if (!_.isEmpty(forbiddenSectionsDiff) || removedJobName) {
      throw new errors.Forbidden(`Automatic update not possible. ${!_.isEmpty(forbiddenSectionsDiff)? 'Detected changes in forbidden sections:' + forbiddenSectionsDiff.join(','): `Job definition removed: ${removedJobName[0]}`}`);
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