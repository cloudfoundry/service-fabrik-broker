'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../../common/config');
const docker = require('../../../data-access-layer/docker');
const BaseManager = require('./BaseManager');
const DockerInstance = require('./DockerInstance');
const errors = require('../../../common/errors');
const NotImplemented = errors.NotImplemented;
const dockerClient = docker.client;

class DockerManager extends BaseManager {
  constructor(plan) {
    super(plan);
    this.credentials = docker.createCredentials(this.plan.credentials);
    this.imageInfo = undefined;
  }

  isAutoUpdatePossible() {
    throw new NotImplemented(`Feature 'Update' not supported for selected service`);
  }

  get imageName() {
    const image = _
      .chain(this.settings)
      .get('image')
      .trim()
      .value();
    const tag = _
      .chain(this.settings)
      .get('tag', 'latest')
      .trim()
      .value();
    return `${image}:${tag}`;
  }

  get hostIsLocal() {
    return _.isEmpty(config.docker.host) || _.includes(['localhost', '127.0.0.1'], config.docker.host);
  }

  get hostIp() {
    return this.hostIsLocal ? config.internal.ip : config.docker.host;
  }

  getContainerName(guid) {
    return `${this.constructor.prefix}-${guid}`;
  }

  createPortBindings(exposedPorts) {
    function extractProtocol(key) {
      return _.nth(key.split('/'), 1);
    }

    function getHostPortBinding(protocol) {
      const binding = {};
      if (config.docker.allocate_docker_host_ports) {
        _.set(binding, 'HostPort', `${docker.acquirePort(protocol || 'tcp')}`);
      }
      return [binding];
    }

    const keys = _.keys(exposedPorts);
    const updateRegistry = _
      .chain(keys)
      .map(key => docker.portsWillBeExhaustedSoon(extractProtocol(key)))
      .some()
      .value();

    return Promise
      .try(() => updateRegistry ? docker.updatePortRegistry() : null)
      .then(() => _
        .chain(keys)
        .map(key => [key, getHostPortBinding(extractProtocol(key))])
        .fromPairs()
        .value()
      );
  }

  static get prefix() {
    return config.docker.prefix || super.prefix;
  }

  static load(plan) {
    if (this[plan.id]) {
      return Promise.resolve(this[plan.id]);
    }

    const manager = new this(plan);

    return dockerClient
      .getImage(manager.imageName)
      .inspectAsync()
      .tap(imageInfo => {
        manager.imageInfo = imageInfo;
        this[plan.id] = manager;
      })
      .return(manager);
  }

  static get instanceConstructor() {
    return DockerInstance;
  }
}

module.exports = DockerManager;