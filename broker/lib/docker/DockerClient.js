'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../../common/config');
const logger = require('../../../common/logger');

Promise.promisifyAll([
  require('dockerode/lib/docker'),
  require('dockerode/lib/container'),
  require('dockerode/lib/image'),
  require('dockerode/lib/exec'),
  require('dockerode/lib/volume'),
  require('dockerode/lib/network')
]);
const Docker = require('dockerode');

/** Client for the Docker HTTP API. */
class DockerClient extends Docker {

  /**
   * Create a docker client with patched modem.
   */
  constructor(opts) {
    super(_.defaults({}, opts, config.docker, {
      timeout: config.http_timeout
    }));
    this.constructor.monkeyPatchModem(this.modem);
  }

  /**
   * Promisified version of the modems follow progress method.
   * The promise is resolved when the stream is finished
   * and rejecet if an error occurs.
   */
  followProgressAsync(stream) {
    return new Promise((resolve, reject) => {
      this.modem.followProgress(stream, (err, output) => {
        if (err) {
          logger.error('Follow progress error:', err);
          if (err instanceof Error) {
            return reject(err);
          }
          if (typeof err === 'string') {
            return reject(new Error(err));
          }
          return reject(new Error(`FollowProgressError: ${err}`));
        }
        resolve(output);
      }, event => logger.silly('Follow progress event:', event));
    });
  }

  /**
   * Monkey patch the docker modem.
   * - Remove upper case options from query parameters
   * - Remove lower case options from body parameters
   */
  static monkeyPatchModem(modem) {
    const Modem = modem.constructor;
    const isQueryParameter = this.isQueryParameter;
    modem.dial = function dial(options, callback) {
      Modem.prototype.dial.call(this, _.cloneDeep(options), callback);
    };
    modem.buildQuerystring = function buildQuerystring(opts) {
      const keys = _
        .chain(opts)
        .keys()
        .filter(isQueryParameter)
        .value();
      const query = _.pick(opts, keys);
      _.each(keys, key => opts[key] = undefined);
      return Modem.prototype.buildQuerystring.call(this, query);
    };
  }

  /**
   * Returns true if the given key is a query paramter.
   */
  static isQueryParameter(key) {
    function isLowerCase(char) {
      return char.toUpperCase() !== char;
    }

    function isException(key) {
      return _.includes([
        'Content-type',
        'X-Registry-Config',
        'X-Registry-Auth'
      ], key);
    }
    return isLowerCase(key.charAt(0)) || isException(key);
  }
}

module.exports = DockerClient;