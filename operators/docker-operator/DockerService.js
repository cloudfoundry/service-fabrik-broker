'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const docker = require('../../data-access-layer/docker');
const catalog = require('../../common/models').catalog;
const Timeout = errors.Timeout;
const ContainerStartError = errors.ContainerStartError;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const CONST = require('../../common/constants');
const assert = require('assert');
const config = require('../../common/config');
const BaseService = require('../BaseService');
const DockerImageLoaderService = require('./DockerImageLoaderService');
const eventmesh = require('../../data-access-layer/eventmesh');

const DockerError = {
  NotFound: {
    statusCode: CONST.HTTP_STATUS_CODE.NOT_FOUND
  },
  Conflict: {
    statusCode: CONST.HTTP_STATUS_CODE.CONFLICT
  },
  ServerError: {
    statusCode: CONST.HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
  }
};

class DockerService extends BaseService {
  constructor(guid, plan) {
    super(plan);
    this.guid = guid;
    this.plan = plan;
    this.platformManager = undefined;
    this.prefix = CONST.SERVICE_FABRIK_PREFIX;
    this.credentials = docker.createCredentials(this.plan.credentials);
    this.imageInfo = undefined;
    this.docker = docker.createClient();
    this.container = this.docker.getContainer(this.containerName);
    this.containerInfo = undefined;
  }

  assignPlatformManager(platformManager) {
    this.platformManager = platformManager;
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
    return `${this.prefix}-${guid}`;
  }


  getVolumeName(volume) {
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
        this.prefix,
        this.guid,
        volume.name,
        formatSize(volume.size)
      ])
      .compact()
      .join('-')
      .value();
  }

  buildContainerOptions(parameters, exposedPorts, options) {
    options = options || {};
    const containerOptions = {
      name: this.getContainerName(this.guid),
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
        containerOptions.HostConfig = this.getHostConfig(this.guid, options.portBindings);
        containerOptions.Env = this.getEnv(this.guid, parameters, options.environment);
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
    const volumeBindings = this.getVolumeBindings();
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
      PidsLimit: CONST.DOCKER_HOST_CONFIG.PIDS_LIMIT,
      VolumeDriver: _.size(volumeBindings) ? volumeDriver : ''
    };
  }

  getVolumeBindings() {
    return _(this.persistentVolumes)
      .map(volume => {
        assert.ok(_.has(volume, 'path'), 'Volume configuration must have a \'path\' property');
        return `${this.getVolumeName(volume)}:${volume.path}`;
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

  get containerName() {
    return this.getContainerName(this.guid);
  }

  get platformContext() {
    return this.inspectContainer()
      .then(() => {
        if (_.get(this.getEnvironment(), 'context') !== undefined) {
          return JSON.parse(this.getEnvironment().context);
        } else {
          /* Following is to handle existing containers.
           For them platform-context is not saved in container env. Defaults to CF.
           This is must required to support existing containers as containers are never updated.
         */
          logger.warn(`Container env '${CONST.PLATFORM_CONTEXT_KEY}' not found for instance '${this.guid}'.\
          Setting default platform as '${CONST.PLATFORM.CF}'`);
          const context = {
            platform: CONST.PLATFORM.CF
          };
          return context;
        }
      })
      .catch(DockerError.NotFound, () => {
        logger.warn(`Container ${this.containerName} not found for instance`);
        return {};
      });
  }

  create(params) {
    const parameters = params.parameters;
    const exposedPorts = this.exposedPorts;
    const options = {
      context: params.context
    };
    return this
      .buildContainerOptions(parameters, exposedPorts, options)
      .then(opts => this.createAndStartContainer(opts, true))
      .catchThrow(DockerError.Conflict, new ServiceInstanceAlreadyExists(this.guid))
      .then(() => this.ensureContainerIsRunning(true))
      .then(() => this.platformManager.postInstanceProvisionOperations({
        ipRuleOptions: this.buildIpRules(),
        guid: this.guid,
        context: params.context
      }));
  }

  update(params) {
    const parameters = params.parameters;
    let exposedPorts;
    const options = {};
    return this
      .inspectContainer()
      .tap(containerInfo => {
        exposedPorts = containerInfo.Config.ExposedPorts;
        options.portBindings = containerInfo.HostConfig.PortBindings;
        options.environment = this.getEnvironment();
      })
      .catchThrow(DockerError.NotFound, new ServiceInstanceNotFound(this.guid))
      .then(() => this.removeContainer())
      .then(() => this.buildContainerOptions(parameters, exposedPorts, options))
      .then(opts => this.createAndStartContainer(opts, false))
      .then(() => this.ensureContainerIsRunning(false));
  }

  delete(params) {
    /* jshint unused:false */
    return Promise.try(() => this
        .platformManager.preInstanceDeleteOperations({
          guid: this.guid
        })
      )
      .then(() => this.removeContainer())
      .catchThrow(DockerError.NotFound, new ServiceInstanceNotFound(this.guid))
      .then(() => this.removeVolumes());
  }

  bind(params) {
    /* jshint unused:false */
    return this
      .inspectContainer()
      .catchThrow(DockerError.NotFound, new ServiceInstanceNotFound(this.guid))
      .then(() => this.createCredentials());
  }

  unbind(params) {
    /* jshint unused:false */
  }

  buildIpRules() {
    const hostIp = this.hostIp;

    function createRule(protocol, address) {
      const ip = address.HostIp;
      const port = address.HostPort;
      return {
        protocol: protocol,
        ips: [ip && ip !== '0.0.0.0' ? ip : hostIp],
        applicationAccessPorts: [port]
      };
    }

    return _
      .chain(this.containerInfo)
      .get('NetworkSettings.Ports')
      .map((addresses, portAndProtocol) => {
        const protocol = _(portAndProtocol).split('/').nth(1);
        return _.map(addresses, address => createRule(protocol, address));
      })
      .flatten()
      .uniq()
      .value();
  }

  createCredentials() {
    const networkInfo = this.getNetworkInfo(this.containerInfo);
    return this.credentials.create(this.getEnvironment(), networkInfo.ip, networkInfo.ports);
  }

  ensureContainerIsRunning(removeVolumes) {
    if (this.containerInfo.State.Running) {
      return undefined;
    }
    const err = new ContainerStartError(`Failed to start docker container '${this.containerName}'`);
    return this
      .removeContainer()
      .catchReturn()
      .then(() => removeVolumes ? this.removeVolumes() : undefined)
      .catchReturn()
      .throw(err);
  }

  inspectContainer() {
    logger.info(`Inspecting docker container '${this.container.id}'...`);
    return this.container
      .inspectAsync()
      .tap(info => {
        logger.info(`+-> docker container has been inspected '${this.container.id}'`);
        if (this.container.id !== info.Id) {
          this.container = this.docker.getContainer(info.Id);
        }
        this.containerInfo = info;
      })
      .catch(err => {
        logger.error(`+-> Failed to inspect docker container '${this.container.id}'`);
        logger.error(err);
        throw err;
      });
  }

  createContainer(opts) {
    logger.info(`Creating docker container with options '${opts.name}'...`);
    logger.info('+-> Create options:', opts);
    return this.docker
      .createContainerAsync(opts)
      .tap(container => {
        this.container = container;
        logger.info(`+-> docker container has been created with id '${container.id}' for options '${opts.name}' `);
      })
      .catch(err => {
        logger.error(`+-> Failed to create docker container '${opts.name}'...`);
        logger.error(err);
        throw err;
      });
  }

  startContainer() {
    logger.info(`Starting docker container '${this.container.id}'...`);
    return this.container
      .startAsync()
      .tap(() => logger.info(`+-> docker container has been started with id - '${this.container.id}' `))
      .catch(err => {
        logger.error(`+-> Failed to start docker container with id - '${this.container.id}' `);
        logger.error(err);
        throw err;
      });
  }

  createAndStartContainer(opts, isNew) {
    const self = this;

    function attempt(tries) {
      return Promise
        .try(() => {
          if (isNew && tries > 0) {
            return self.createPortBindings(opts.ExposedPorts)
              .tap(portBindings => _.set(opts.HostConfig, 'PortBindings', portBindings));
          }
        })
        .then(() => self
          .createContainer(opts)
        )
        .then(() => self
          .startContainer()
          .catch(DockerError.ServerError, err => self
            .removeContainer()
            .then(() => docker.updatePortRegistry())
            .throw(new ContainerStartError(err.message))
          )
        );
    }

    function throwTimeoutError(err) {
      throw err.error;
    }

    return utils
      .retry(attempt, {
        predicate: ContainerStartError,
        maxAttempts: 3,
        minDelay: 50
      })
      .catch(Timeout, throwTimeoutError)
      .then(() => this.inspectContainer());
  }

  removeContainer() {
    logger.info(`Removing docker container '${this.container.id}'...`);
    return this.container
      .removeAsync({
        v: true,
        force: true
      })
      .tap(() => logger.info(`+-> docker container has been removed with id '${this.container.id}' `))
      .catch(err => {
        logger.error(`+-> Failed to remove docker container with id '${this.container.id}' `);
        logger.error(err);
        throw err;
      });
  }

  removeVolume(volumeName) {
    logger.info(`Removing Docker volume '${volumeName}'...`);
    return this.docker
      .getVolume(volumeName)
      .removeAsync()
      .tap(() => logger.info(`+-> Docker volume has been removed with volume name - '${volumeName}' `))
      .catch(DockerError.NotFound, () => logger.warn(`+-> Docker volume not found with volume name '${volumeName}' `))
      .catch(err => {
        logger.error(`+-> Failed to remove Docker volume with name '${volumeName}' `);
        logger.error(err);
        throw err;
      });
  }

  removeVolumes() {
    return this.docker
      .listVolumesAsync({
        filters: '{"dangling":{"true":true}}'
      })
      .then(result => _
        .chain(result)
        .get('Volumes')
        .filter(volume => _.startsWith(volume.Name, this.containerName))
        .value()
      )
      .map(volume => this.removeVolume(volume.Name))
      .return();
  }

  getNetworkInfo(containerInfo) {
    const info = {
      ports: {}
    };
    _.each(containerInfo.NetworkSettings.Ports, (values, key) => {
      if (_.size(values)) {
        const value = _.first(values);
        info.ip = value.HostIp;
        info.ports[key] = value.HostPort;
      }
    });
    if (info.ip === '0.0.0.0') {
      info.ip = this.hostIp;
    }
    return info;
  }

  getEnvironment() {
    return _
      .chain(this.containerInfo)
      .get('Config.Env')
      .map(kv => _.slice(/^([^=]+)=(.*)$/.exec(kv), 1))
      .fromPairs()
      .value();
  }

  /* Dashboard rendering functions */
  getInfo() {
    return Promise
      .all([
        eventmesh.apiServerClient.getResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
          resourceId: this.guid
        }),
        this.inspectContainer()
      ])
      .spread((instance, containerInfo) => {
        /* jshint unused:false */
        return Promise.all([
          instance,
          this.getDetails(),
          this.getProcesses(),
          this.getLogs()
        ]);
      })
      .spread((instance, details, processes, logs) => {
        return {
          title: `${this.plan.service.metadata.displayName || 'Service'} Dashboard`,
          plan: this.plan,
          service: this.plan.service,
          instance: instance,
          details: details,
          processes: processes,
          files: [{
            id: 'stdout',
            title: 'Standard',
            language: 'ansi',
            content: logs[0]
          }, {
            id: 'stderr',
            title: 'Error',
            language: 'xxxx',
            content: logs[1]
          }]
        };
      });
  }

  getDetails() {
    logger.info(`Building details hash for container '${this.containerName}'...`);
    const info = {
      'ID': this.containerInfo.Id,
      'Name': this.containerInfo.Name,
      'Created': utils.getTimeAgo(this.containerInfo.Created),
      'Status': this.getContainerStatus(this.containerInfo.State)
    };
    const config = {
      'Image': this.containerInfo.Config.Image,
      'Entrypoint': _.join(this.containerInfo.Config.Entrypoint, ' '),
      'Command': _.join(this.containerInfo.Config.Cmd, ' '),
      'Work Directory': this.containerInfo.Config.WorkingDir,
      'User': this.containerInfo.Config.User
    };
    const hostConfig = {
      'CPU Shares': this.containerInfo.HostConfig.CpuShares,
      'Memory': this.containerInfo.HostConfig.Memory,
      'Memory Swap': this.containerInfo.HostConfig.MemorySwap,
    };
    const networkSettings = {
      'Host IP': undefined,
      'Container IP': this.containerInfo.NetworkSettings.IPAddress
    };
    const details = {
      'Container': info,
      'Configuration': config,
      'Host Configuration': hostConfig,
      'Environment Variables': this.getEnvironment()
    };
    if (this.containerInfo.State.Running) {
      _.assign(hostConfig, {
        'Privileged': this.containerInfo.HostConfig.Privileged,
      });
      const networkInfo = this.getNetworkInfo(this.containerInfo);
      _.assign(networkSettings, {
        'Host IP': networkInfo.ip
      });
      _.assign(details, {
        'Network Settings': networkSettings,
        'Exposed Ports': networkInfo.ports,
        'Exposed Volumes': this.containerInfo.HostConfig.Binds
      });
    }
    return details;
  }

  getContainerStatus(state) {
    if (state.Running) {
      return `Up for ${utils.getTimeAgo(state.StartedAt, true)}${state.Paused ? ' (Paused)' : ''}`;
    }
    if (state.ExitCode > 0) {
      return `Exited (${state.ExitCode}) ${utils.getTimeAgo(state.FinishedAt)}`;
    }
    return 'Stopped';
  }

  getProcesses() {
    if (this.containerInfo.State.Running) {
      return this.container
        .topAsync({
          ps_args: 'aux'
        })
        .then(top => _.concat([top.Titles], top.Processes));
    }
  }

  getLogs() {
    return this.container
      .logsAsync({
        stdout: 1,
        stderr: 1,
        timestamps: 1
      })
      .then(stream => utils.demux(stream, {
        tail: 1000
      }));
  }

  static createInstance(instanceId, options) {
    const planId = options.plan_id;
    const plan = catalog.getPlan(planId);
    const context = _.get(options, 'context');
    const dockerService = new DockerService(instanceId, plan);

    return DockerImageLoaderService.load(plan)
      .tap(manager => {
        dockerService.imageInfo = manager.imageInfo;
      })
      .then(() => context ? context : dockerService.platformContext)
      .then(context => dockerService.assignPlatformManager(utils.getPlatformManager(context)))
      .return(dockerService);
  }
}

module.exports = DockerService;