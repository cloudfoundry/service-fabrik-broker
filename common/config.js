'use strict';

const fs = require('fs');
const Promise = require('bluebird');
const path = require('path');
const parseUrl = require('url').parse;
const formatUrl = require('url').format;
const child_process = require('child_process');
const yaml = require('js-yaml');
const _ = require('lodash');
const filename = process.env.SETTINGS_PATH;

const ENV = process.env.NODE_ENV || 'development';
process.env.NODE_ENV = _
  .chain(ENV)
  .split(/[_-]/)
  .first()
  .value();
const buffer = fs.readFileSync(filename, 'utf8');
const context = {
  require: require,
  __filename: filename,
  __dirname: path.dirname(filename),
  base64_template: function (filePath) {
    const template = path.join(this.__dirname, filePath);
    return fs.readFileSync(template).toString('base64');
  },
  certificate: function (name) {
    const filename = path.join(this.__dirname, 'certs', name);
    return JSON.stringify(fs.readFileSync(filename).toString('ascii'));
  }
};
const config = yaml.safeLoad(_.template(buffer)(context))[ENV];
if (config.directors) {
  config.directors.forEach(director => completeDirectorConfig(director));
}
if (process.env.worker) {
  updateLogFileConfig(config.log_path);
}
if (config.docker) {
  completeDockerConfig(config.docker);
}
if (config.cf) {
  completeCloudFoundryConfig(config.cf);
}
if (config.enable_circuit_breaker) {
  //Tests fail because of circuits tripping because of negative scenarios.
  const hystrixConfig = require('hystrixjs').hystrixConfig;
  hystrixConfig.init({
    // any other hystrix options...
    'hystrix.promise.implementation': Promise
  });
  completeCircutBreakerConfig(config);
} else {
  console.log('circuit breaker is disabled');
}

function updateLogFileConfig(logPath) {
  const logSuffix = `-worker-${process.env.worker}.log`;
  config.log_path = logPath.indexOf('.log') !== -1 ? logPath.replace('.log', logSuffix) : `${logPath}-${logSuffix}`;
}

function completeDirectorConfig(director) {
  if (!director.uuid || !director.cpi) {
    const options = ['--connect-timeout 5', '-s'];
    if (director.skip_ssl_validation) {
      options.push('-k');
    }
    if (director.username) {
      options.push(`-u ${director.username}:${director.password}`);
    }
    const info = JSON.parse(child_process.execSync(`curl ${options.join(' ')} ${director.url}/info`));
    _.defaults(director, {
      uuid: info.uuid,
      cpi: info.cpi
    });
  }
  let boshRateLimitEnabled = config.enable_bosh_rate_limit;
  if (boshRateLimitEnabled) {
    const maxWorkers = _.get(director, 'max_workers', 6);
    const userCreateWorkers = _.get(director, 'policies.user.create.max_workers');
    const userUpdateWorkers = _.get(director, 'policies.user.update.max_workers');
    const autoWorkers = _.get(director, 'policies.scheduled.max_workers', (maxWorkers / 2));

    if (userCreateWorkers === undefined || userUpdateWorkers === undefined) {
      throw new Error('Invalid director config: user policy share numbers not defined');
    }

    if (_.sum([userCreateWorkers, userUpdateWorkers, autoWorkers]) > maxWorkers) {
      throw new Error('Invalid director config: policy shares add up to more than max_workers count');
    }
  }
}

function completeDockerConfig(docker) {
  const opts = {
    ip_local_port_range: ipLocalPortRange(docker.ip_local_port_range)
  };
  const dockerUrl = docker.url || process.env.DOCKER_HOST;
  if (dockerUrl) {
    const url = parseUrl(dockerUrl);
    if (!url.protocol || url.protocol === 'unix:') {
      opts.socketPath = url.pathname;
    } else {
      opts.host = url.hostname;
      opts.port = url.port;
      opts.protocol = url.protocol.replace(/:$/, '');
      if (opts.protocol === 'tcp') {
        if (process.env.DOCKER_TLS_VERIFY === '1' || opts.port === 2376) {
          opts.protocol = 'https';
        } else {
          opts.protocol = 'http';
        }
      }
    }
  }
  //const dockerCertPath = docker.cert_path || process.env.DOCKER_CERT_PATH;
  if (process.env.DOCKER_TLS_VERIFY === '1') {
    opts.ca = [
      docker.ssl.ca
    ];
    opts.cert = docker.ssl.cert;
    opts.key = docker.ssl.key;
  }
  _.defaults(docker, opts);
}

function completeCloudFoundryConfig(cf) {
  const endpoint = parseUrl(cf.url);
  endpoint.host = undefined;
  const domain = endpoint.hostname.split('.').slice(1).join('.');
  const authorization_endpoint = formatUrl(_.assign({}, endpoint, {
    hostname: `login.${domain}`
  })).replace(/\/$/, '');
  const token_endpoint = formatUrl(_.assign({}, endpoint, {
    hostname: `uaa.${domain}`
  })).replace(/\/$/, '');
  _.defaults(cf, {
    authorization_endpoint: authorization_endpoint,
    token_endpoint: token_endpoint
  });
}


function ipLocalPortRange(portRange) {
  if (_.isArray(portRange)) {
    return portRange;
  }
  if (!/^\s*\d+\s+\d+\s*$/.test(portRange)) {
    try {
      portRange = fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'ascii');
    } catch (err) {
      portRange = '32768 61000';
    }
  }
  return _.compact(_.split(portRange, /\s+/));
}

function completeCircutBreakerConfig(config) {
  const configFileName = 'circuit-breaker-config.yml';
  const circuitBreakerConfigAbsPath = process.env.CONF_DIR ? path.join(process.env.CONF_DIR, configFileName) :
    path.join(__dirname, '..', 'config', configFileName);
  if (fs.existsSync(circuitBreakerConfigAbsPath)) {
    config.circuit_breaker = yaml.safeLoad(fs.readFileSync(circuitBreakerConfigAbsPath, 'utf8'));
  } else {
    console.log('Circuit break config not found. Hystrix will not be configured.');
  }
}

module.exports = config;