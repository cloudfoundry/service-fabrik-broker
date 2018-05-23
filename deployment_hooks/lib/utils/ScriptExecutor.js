'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const child_process = require('child_process');
const logger = require('../logger');
const errors = require('../errors');
const config = require('../config');

class ScriptExecutor {
  constructor(command) {
    this.command = command;
  }

  execute() {
    return new Promise((resolve, reject) => {
      let args = {};
      _.forEach(arguments, (value) => {
        _.assign(args, value);
      });
      let executable_command = `${this.command} '${JSON.stringify(args)}'`;
      if (config.enable_syscall_filters) {
        // call seccomp executable with supported command line args
        // <path-to-seccomp-executable> '<executable_command>' <syscall1> <syscall2> <syscall3> ...
        executable_command = `${SECCOMP_CMD} "${this.command} '${JSON.stringify(args).replace(/"/g, '\\"')}'" `;
      }
      logger.info(executable_command);
      child_process.exec(executable_command, (err, stdout, stderr) => {
        if (err === null) {
          try {
            stdout = JSON.parse(stdout);
          } catch (err) {
            logger.warn(`Command ${this.command} out put is not json. Its recommended to output json`);
          }
          return resolve(stdout);
        } else {
          const errResponse = {
            code: err.code,
            description: stderr !== '' ? stderr : stdout
          };
          return reject(new errors.InternalServerError(`${errResponse.description}`));
        }
      });
    });
  }
}

module.exports = ScriptExecutor;