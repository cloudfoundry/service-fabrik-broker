'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const child_process = require('child_process');
const logger = require('../logger');
const errors = require('../errors');

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
      logger.info(`executing script with arguments: ${JSON.stringify(args)} `);
      child_process.exec(`${this.command} '${JSON.stringify(args)}'`, (err, stdout, stderr) => {
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