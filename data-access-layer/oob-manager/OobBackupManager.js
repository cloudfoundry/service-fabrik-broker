'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('@sf/logger');
const backupStore = require('@sf/iaas').backupStoreForOob;
const {
  CONST,
  errors: {
    NotFound,
    UnprocessableEntity,
    BadRequest
  },
  commonFunctions
} = require('@sf/common-utils');
const { director } = require('@sf/bosh');
const Agent = require('../service-agent');

class OobBackupManager {

  constructor() {
    this.boshDirector = director;
  }

  startBackup(opts) {
    if (_.isEmpty(opts.deploymentName)) {
      throw new BadRequest('Deployment name is mandatory to start deployment.');
    }
    const deploymentName = opts.deploymentName;
    const args = opts.arguments;

    logger.debug(`--> OobBackupManager: Starting OOB backup for: ${deploymentName}`);
    const backup = {
      guid: undefined,
      type: _.get(args, 'type', 'online'),
      secret: undefined,
      trigger: _.get(args, 'trigger', CONST.BACKUP.TRIGGER.ON_DEMAND)
    };

    const data = {
      username: opts.user.name,
      deployment_name: deploymentName,
      operation: 'backup',
      type: backup.type,
      backup_guid: undefined,
      trigger: backup.trigger,
      state: 'processing',
      secret: undefined,
      agent_ip: undefined,
      started_at: new Date().toISOString(),
      finished_at: null,
      root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
    };

    const result = {
      operation: 'backup',
      backup_guid: undefined,
      agent_ip: undefined
    };

    function createSecret() {
      return commonFunctions.randomBytes(12)
        .then(buffer => buffer.toString('base64'));
    }
    return Promise
      .all([
        commonFunctions.uuidV4(),
        createSecret(),
        this.boshDirector.getDeploymentIps(deploymentName),
        this.boshDirector.getNormalizedDeploymentVms(deploymentName),
        opts.agent_properties ? opts.agent_properties : this.boshDirector.getAgentPropertiesFromManifest(deploymentName)
      ])
      .spread((backup_guid, secret, ips, vms, agentProperties) => {
        logger.info(`-> initiating ServiceFabrik DB backup with guid : ${backup_guid} on agents : ${ips}`);
        backup.guid = data.backup_guid = result.backup_guid = backup_guid;
        data.secret = backup.secret = secret;
        data.container = _.get(args, 'container') || agentProperties.provider.container;
        let agent = new Agent(this.getAgentFromAgentProperties(agentProperties));
        return agent
          .getHost(ips, 'backup')
          .tap(ip => agent.startBackup(ip, backup, vms))
          .then(agent_ip => {
            // set data and result agent ip
            logger.info(`Service Fabrik Backup initiated by agent : ${agent_ip} - updating meta info `);
            data.agent_ip = result.agent_ip = agent_ip;
            return backupStore.putFile(data);
          });
      })
      .return(result);
  }

  getLastBackupStatus(opts) {
    const agent_ip = opts.agent_ip;

    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }

    const deploymentName = opts.deploymentName;

    return Promise.try(() => {
      if(!opts.agent_properties) {
        return this.boshDirector.getAgentPropertiesFromManifest(deploymentName);
      }
      return opts.agent_properties;
    })
      .then(agentProperties => {
        const agent = new Agent(this.getAgentFromAgentProperties(agentProperties));
        return agent
          .getBackupLastOperation(agent_ip)
          .tap(lastOperation => {
            if (isFinished(lastOperation.state)) {
              agent.getBackupLogs(agent_ip)
                .then(logs => backupStore
                  .patchBackupFile({
                    deployment_name: deploymentName,
                    root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
                  }, {
                    state: lastOperation.state,
                    logs: logs,
                    snapshotId: lastOperation.snapshotId
                  })
                );
            }
          });
      });
  }

  getBackup(deploymentName, backupGuid, agentProperties) {
    const opts = {
      deployment_name: deploymentName,
      backup_guid: undefined,
      root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
    };

    if (backupGuid) {
      opts.backup_guid = backupGuid;
      logger.info(`Retrieving backup with options : ${JSON.stringify(opts)}`);
      return backupStore
        .getBackupFile(opts)
        .then(metadata => {
          logger.debug('Retrieved backup info :', metadata);
          switch (metadata.state) {
            case 'processing':
              return Promise.try(() => {
                if(!agentProperties) {
                  return this.boshDirector.getAgentPropertiesFromManifest(deploymentName);
                }
                return agentProperties;
              })
                .then(brokerAgentProperties => {
                  const agent = new Agent(this.getAgentFromAgentProperties(brokerAgentProperties));
                  return agent.getBackupLastOperation(metadata.agent_ip)
                    .then(data => [_.assign(metadata, _.pick(data, 'state', 'stage'))]);
                });
            default:
              return [metadata];
          }
        });
    } else {
      return backupStore.listBackupFiles(opts);
    }
  }

  startRestore(opts) {
    const deploymentName = opts.deploymentName;

    return backupStore
      .getBackupFile({
        deployment_name: deploymentName,
        backup_guid: opts.backup_guid,
        root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
      })
      .catchThrow(NotFound, new UnprocessableEntity(`backup for OOB deployment - ${deploymentName} with guid '${opts.backup_guid}' not found`))
      .tap(metadata => {
        if (metadata.state !== 'succeeded') {
          throw new UnprocessableEntity(`Cannot restore backup '${opts.backup_guid}' due to state '${metadata.state}'`);
        }
      })
      .then(metadata => {
        const backup = {
          guid: opts.backup_guid,
          type: metadata.type,
          secret: metadata.secret
        };

        const data = {
          operation: 'restore',
          deployment_name: deploymentName,
          backup_guid: backup.guid,
          state: 'processing',
          agent_ip: undefined,
          started_at: new Date().toISOString(),
          finished_at: null,
          username: opts.user.name,
          root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
        };

        var result = { // eslint-disable-line no-var
          operation: 'restore',
          agent_ip: undefined
        };
        result = _.assign(result, {
          backup_guid: opts.backup_guid
        });
        return Promise
          .all([
            this.boshDirector.getDeploymentIps(deploymentName),
            this.boshDirector.getNormalizedDeploymentVms(deploymentName),
            opts.agent_properties ? opts.agent_properties : this.boshDirector.getAgentPropertiesFromManifest(deploymentName)
          ])
          .spread((ips, vms, agentProperties) => {
            logger.info(`-> initiating deployment ${deploymentName} restore with backup guid : ${opts.backup_guid} on agents : ${ips}`);
            return new Agent(this.getAgentFromAgentProperties(agentProperties))
              .startRestore(ips, backup, vms)
              .then(agent_ip => {
                // set data and result agent ip
                data.agent_ip = result.agent_ip = agent_ip;
                return backupStore.putFile(data);
              });
          })
          .return(result);
      });
  }

  getLastRestoreStatus(opts) {
    const agent_ip = opts.agent_ip;
    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }
    const deploymentName = opts.deploymentName;

    return Promise.try(() => {
      if(!opts.agent_properties) {
        return this.boshDirector.getAgentPropertiesFromManifest(deploymentName);
      }
      return opts.agent_properties;
    })
      .then(agentProperties => {
        const agent = new Agent(this.getAgentFromAgentProperties(agentProperties));
        return agent.getRestoreLastOperation(agent_ip)
          .tap(lastOperation => {
            if (isFinished(lastOperation.state)) {
              agent.getRestoreLogs(agent_ip)
                .then(logs => backupStore
                  .patchRestoreFile({
                    deployment_name: deploymentName,
                    root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
                  }, {
                    state: lastOperation.state,
                    logs: logs
                  })
                );
            }
          });
      });
  }

  getRestore(deploymentName, agentProperties) {
    const opts = {
      deployment_name: deploymentName,
      backup_guid: undefined,
      root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
    };
    return backupStore
      .getRestoreFile(opts)
      .then(metadata => {
        switch (metadata.state) {
          case 'processing':
            return Promise.try(() => {
              if(!agentProperties) {
                return this.boshDirector.getAgentPropertiesFromManifest(deploymentName);
              }
              return agentProperties;
            })
              .then(brokerAgentProperties => {
                const agent = new Agent(this.getAgentFromAgentProperties(brokerAgentProperties));
                return agent.getRestoreLastOperation(metadata.agent_ip)
                  .then(data => _.assign(metadata, _.pick(data, 'state', 'stage')));
              });
          default:
            return metadata;
        }
      });
  }

  /* Helper functions  */

  getAgentFromAgentProperties(agentProperties) {
    return {
      version: agentProperties.version || '1',
      provider: agentProperties.provider,
      auth: {
        username: agentProperties.username,
        password: agentProperties.password
      }
    };
  }

  static getInstance(directorName) {
    directorName = directorName || CONST.BOSH_DIRECTORS.BOSH;
    if (!OobBackupManager.instances[directorName]) {
      OobBackupManager.instances[directorName] = new OobBackupManager(directorName);
    }
    logger.debug(`--> OobBackupManager: getInstance : ${directorName}`);
    return OobBackupManager.instances[directorName];
  }
}

OobBackupManager.instances = {};

module.exports = OobBackupManager;
