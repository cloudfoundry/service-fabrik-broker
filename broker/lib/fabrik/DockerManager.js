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

  get command() {
    return _
      .chain(this.settings)
      .get('command')
      .split(' ')
      .value();
  }

  get entrypoint() {
    return _(this.settings)
      .get('entrypoint');
  }

  get restartPolicy() {
    return _
      .chain(this.settings)
      .get('restart', 'always')
      .split(':')
      .zipObject(['Name', 'MaximumRetryCount'])
      .invert()
      .value();
  }

  get workdir() {
    return _(this.settings)
      .get('workdir');
  }

  get environment() {
    return _
      .chain(this.settings)
      .get('environment')
      .compact()
      .value();
  }

  get exposedPorts() {
    const exposedPorts = _
      .chain(this.settings)
      .get('expose_ports')
      .compact()
      .map(port => [port, {}])
      .fromPairs()
      .value();
    return _.size(exposedPorts) ? exposedPorts : _(this.imageInfo)
      .get('Config.ExposedPorts');
  }

  get persistentVolumes() {
    return _
      .chain(this.settings)
      .get('persistent_volumes')
      .compact()
      .value();
  }

  get user() {
    return _(this.settings)
      .get('user', '');
  }

  get memory() {
    return _(this.settings)
      .get('memory', 0);
  }

  get memorySwap() {
    return _(this.settings)
      .get('memory_swap', 0);
  }

  get cpuShares() {
    return _(this.settings)
      .get('cpu_shares');
  }

  get privileged() {
    return !!_(this.settings)
      .get('privileged');
  }

  get cap() {
    const adds = _(this.settings)
      .get('cap_adds', []);
    const drops = _(this.settings)
      .get('cap_drops', []);
    return {
      adds: adds,
      drops: drops
    };
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

  getVolumeName(guid, volume) {
    assert.ok(_.has(volume, 'name'), 'Volume configuration must have a \'name\' property');

    function formatSize(size) {
      if (/^\s*[0-9]+[gm]?\s*$/i.test(size)) {
        return _
          .chain(size)
          .trim()
          .toUpper()
          .replace(/^/, 'oS')
          .value();
      }
    }
    return _
      .chain([
        this.constructor.prefix,
        guid,
        volume.name,
        formatSize(volume.size)
      ])
      .compact()
      .join('-')
      .value();
  }

  buildContainerOptions(guid, parameters, exposedPorts, options) {
    options = options || {};
    const containerOptions = {
      name: this.getContainerName(guid),
      Hostname: '',
      Domainname: '',
      User: this.user,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      OpenStdin: false,
      StdinOnce: false,
      Env: undefined,
      Cmd: this.command,
      Entrypoint: this.entrypoint,
      Image: this.imageName,
      Labels: {},
      Volumes: {},
      WorkingDir: this.workdir,
      NetworkDisabled: false,
      ExposedPorts: exposedPorts,
      HostConfig: undefined
    };

    if (!options.portBindings) {
      options.portBindings = this.createPortBindings(exposedPorts);
    }
    if (!options.environment) {
      options.environment = this.credentials.createEnvironment();
    }
    return Promise
      .props(options)
      .then(options => {
        if (options.context) {
          options.environment.context = options.context;
        }
        containerOptions.HostConfig = this.getHostConfig(guid, options.portBindings);
        containerOptions.Env = this.getEnv(guid, parameters, options.environment);
        return containerOptions;
      });
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

  getHostConfig(guid, portBindings) {
    const volumeBindings = this.getVolumeBindings(guid);
    const volumeDriver = config.docker.volume_driver || 'local';
    return {
      Binds: volumeBindings,
      Links: null,
      Memory: this.convertSize(this.memory),
      MemorySwap: this.convertSize(this.memorySwap),
      CpuShares: this.cpuShares,
      PortBindings: portBindings,
      PublishAllPorts: false,
      Privileged: this.privileged,
      ReadonlyRootfs: false,
      VolumesFrom: [],
      CapAdd: this.cap.adds,
      CapDrop: this.cap.drops,
      RestartPolicy: this.restartPolicy,
      Devices: [],
      Ulimits: [],
      VolumeDriver: _.size(volumeBindings) ? volumeDriver : ''
    };
  }

  getVolumeBindings(guid) {
    return _(this.persistentVolumes)
      .map(volume => {
        assert.ok(_.has(volume, 'path'), 'Volume configuration must have a \'path\' property');
        return `${this.getVolumeName(guid, volume)}:${volume.path}`;
      })
      .value();
  }

  convertSize(memory) {
    /* jshint bitwise:false */
    if (_.isNil(memory)) {
      return null;
    }
    if (_.isInteger(memory)) {
      return memory;
    }
    const unit = memory.slice(-1);
    const amount = parseInt(memory.slice(0, -1));
    switch (unit) {
    case 'b':
      return amount;
    case 'k':
      return (amount << 10);
    case 'm':
      return (amount << 20);
    case 'g':
      return (amount << 30);
    default:
      return parseInt(memory);
    }
  }

  getEnv(guid, parameters, environment) {
    return _
      .chain([
        this.getEnvCustom(),
        this.getEnvCredentials(environment),
        this.getEnvContainer(guid),
        this.getEnvParameters(_.assign(parameters || {}, environment.context ? {
          context: JSON.stringify(environment.context)
        } : {}))
      ])
      .flatten()
      .compact()
      .value();
  }

  getEnvCustom() {
    return _
      .chain(this.environment)
      .map(keyValue => {
        const keyValueParts = keyValue.split('=');
        const key = _.trim(_.first(keyValueParts));
        const value = _.trim(_.last(keyValueParts));
        return `${key}=${value}`;
      })
      .compact()
      .value();
  }

  getEnvCredentials(environment) {
    return _
      .chain(environment)
      .pick([
        this.credentials.usernameKey,
        this.credentials.passwordKey,
        this.credentials.dbnameKey
      ])
      .map((value, key) => `${key}=${value}`)
      .value();
  }

  getEnvContainer(guid) {
    return _.concat(`NAME=${this.getContainerName(guid)}`, config.docker.container_env_vars);
  }

  getEnvParameters(parameters) {
    return _.map(parameters, (value, key) => `${key}=${value}`);
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