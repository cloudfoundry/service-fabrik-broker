'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../../../common/logger');
const errors = require('../../../common/errors');
const utils = require('../utils');
const docker = require('../docker');
const BaseInstance = require('./BaseInstance');
const catalog = require('../models').catalog;
const Timeout = errors.Timeout;
const ContainerStartError = errors.ContainerStartError;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const CONST = require('../../../common/constants');

const DockerError = {
  NotFound: {
    statusCode: 404
  },
  Conflict: {
    statusCode: 409
  },
  ServerError: {
    statusCode: 500
  }
};

class DockerInstance extends BaseInstance {
  constructor(guid, manager) {
    super(guid, manager);
    this.docker = docker.createClient();
    this.container = this.docker.getContainer(this.containerName);
    this.containerInfo = undefined;
  }

  static get typeDescription() {
    return 'docker container';
  }

  get containerName() {
    return this.manager.getContainerName(this.guid);
  }

  getVolumeName(volume) {
    return this.manager.getVolumeName(this.guid, volume);
  }

  get async() {
    return false;
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
    const exposedPorts = this.manager.exposedPorts;
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
    const hostIp = this.manager.hostIp;

    function createRule(protocol, address) {
      const ip = address.HostIp;
      const port = address.HostPort;
      return {
        protocol: protocol,
        ips: [ip && ip !== '0.0.0.0' ? ip : hostIp],
        ports: [port]
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
    return this.manager.credentials.create(this.getEnvironment(), networkInfo.ip, networkInfo.ports);
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

  buildContainerOptions(parameters, exposedPorts, options) {
    return this.manager.buildContainerOptions(this.guid, parameters, exposedPorts, options);
  }

  createAndStartContainer(opts, isNew) {
    const self = this;

    function attempt(tries) {
      return Promise
        .try(() => {
          if (isNew && tries > 0) {
            return self.manager
              .createPortBindings(opts.ExposedPorts)
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
      info.ip = this.manager.hostIp;
    }
    return info;
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

  getInfo() {
    return Promise
      .all([
        this.cloudController.getServiceInstance(this.guid),
        this.inspectContainer()
      ])
      .spread((instance, containerInfo) => {
        /* jshint unused:false */
        return Promise.all([
          instance,
          this.getDetails(),
          this.getProcesses(),
          this.getLogs(),
          this.cloudController.getServicePlan(instance.entity.service_plan_guid, {})
        ]);
      })
      .spread((instance, details, processes, logs, planInfo) => {
        var currentPlan = catalog.getPlan(planInfo.entity.unique_id);
        return {
          title: `${currentPlan.service.metadata.displayName || 'Service'} Dashboard`,
          plan: currentPlan,
          service: currentPlan.service,
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
  getContainerStatus(state) {
    if (state.Running) {
      return `Up for ${utils.getTimeAgo(state.StartedAt, true)}${state.Paused ? ' (Paused)' : ''}`;
    }
    if (state.ExitCode > 0) {
      return `Exited (${state.ExitCode}) ${utils.getTimeAgo(state.FinishedAt)}`;
    }
    return 'Stopped';
  }

  getEnvironment() {
    return _
      .chain(this.containerInfo)
      .get('Config.Env')
      .map(kv => _.slice(/^([^=]+)=(.*)$/.exec(kv), 1))
      .fromPairs()
      .value();
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
}

module.exports = DockerInstance;