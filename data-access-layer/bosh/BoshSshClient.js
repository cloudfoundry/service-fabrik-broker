'use strict';

const Promise = require('bluebird');
const Client = require('ssh2').Client;
const logger = require('../../common/logger');
const {
  SshConnectionFailed
} = require('../../common/errors');

const sshPublicKeyPattern = /^ssh-rsa AAAA[0-9A-Za-z+/]+[=]{0,3}( [^@]+@[^@]+)?$/;

class BoshSshClient {
  constructor(connectOptions, boshDeploymentOptions) {
    this.connectOptions = connectOptions;
    this.deploymentOptions = boshDeploymentOptions;
  }

  static isValidPublicKey(publickey) {
    return sshPublicKeyPattern.test(publickey);
  }

  getConnection() {
    const config = this.connectOptions;
    return new Promise((resolve, reject) => {
        let connection = new Client();
        connection.on('error', err => {
          if (err.level === 'client-authentication') {
            logger.error('Failed authenticate for ssh connection with config', config, err);
            reject(new SshConnectionFailed('Failed to authenticate for ssh to BOSH VM. Public key not found/ not available in authorized keys within VM'));
          } else {
            logger.error('Failed establish ssh connection with config ', config, err);
            reject(new SshConnectionFailed(err.message));
          }
        });
        connection.on('ready', () => {
          logger.debug('Connecting SSH Successful with config', config);
          resolve(connection);
        });
        logger.debug('Connecting via SSH with config ', config);
        connection.connect(config);
      })
      .then(connection => Promise.try(() => connection)
        .disposer(connection => {
          logger.debug('closing ssh connection');
          connection.end();
        })
      );
  }

  executeCommand(connection, command) {
    return new Promise((resolve, reject) => {
      let output = [];
      let errorOutput = [];
      connection.exec(command, (err, stream) => {
        if (err) {
          logger.error('Failed to exec command over ssh', err);
          reject(new SshConnectionFailed(err.message));
        }
        stream.on('data', data => {
          output.push(data);
        });
        stream.stderr.on('data', data => {
          errorOutput.push(data);
        });
        stream.on('close', (code) => {
          resolve({
            'code': code,
            'stdout': output.join('').trim(),
            'stderr': errorOutput.join('').trim()
          });
        });
      });
    });
  }

  run(linuxCommand) {
    logger.info('Starting SSH connection for ', this.connectOptions, this.boshDeploymentOptions);
    return Promise.using(this.getConnection(), connection => {
      return this.executeCommand(connection, linuxCommand);
    });
  }
}

module.exports = BoshSshClient;