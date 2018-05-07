'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const path = require('path');
const child_process = require('child_process');
const logger = require('../logger');
const errors = require('../errors');

class ScriptExecutor {
  constructor(scriptAbsPath) {
    const fileParts = _.split(scriptAbsPath, path.sep);
    this.fileName = fileParts[fileParts.length - 1];
    this.scriptPath = scriptAbsPath;
  }

  execute() {
    return new Promise((resolve, reject) => {
      let args = {};
      _.forEach(arguments, (value) => {
        _.assign(args, value);
      });
      logger.info(`executing script with arguments: ${JSON.stringify(args)} `);
      child_process.exec(`${this.scriptPath} '${JSON.stringify(args)}'`, (err, stdout, stderr) => {
        if (err === null) {
          try {
            stdout = JSON.parse(stdout);
          } catch (err) {
            logger.warn(`Script ${this.fileName} out put is not json. Its recommended to output json`);
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