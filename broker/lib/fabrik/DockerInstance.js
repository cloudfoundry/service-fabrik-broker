'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../../../common/logger');
const utils = require('../../../common/utils');
const docker = require('../../../data-access-layer/docker');
const BaseInstance = require('./BaseInstance');
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

  get containerName() {
    return this.manager.getContainerName(this.guid);
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