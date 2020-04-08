'use strict';

const _ = require('lodash');
const uuid = require('uuid');
const crypto = require('crypto');
const Promise = require('bluebird');
const randomBytes = Promise.promisify(crypto.randomBytes);
const Readable = require('stream').Readable;
const config = require('@sf/app-config');

const RetryOperation = require('./RetryOperation');
const CONST = require('./commonVariables');
const {
  NotImplemented
} = require('./errors');

exports.retry = RetryOperation.retry;
exports.compareVersions = compareVersions;
exports.encodeBase64 = encodeBase64;
exports.decodeBase64 = decodeBase64;
exports.uuidV4 = uuidV4;
exports.isServiceFabrikOperation = isServiceFabrikOperation;
exports.streamToPromise = streamToPromise;
exports.isFeatureEnabled = isFeatureEnabled;
exports.verifyFeatureSupport = verifyFeatureSupport;
exports.isRestorePossible = isRestorePossible;
exports.getPlatformFromContext = getPlatformFromContext;
exports.unifyDiffResult = unifyDiffResult;

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
