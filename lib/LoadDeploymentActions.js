'use strict';

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const NotImplemented = require('./errors').NotImplemented;
const CONST = require('./constants');
const config = require('./config');
const logger = require('./logger');

loadActionScripts(config.actions);

function loadActionScripts(actions) {
  function ensureDirectoryExist(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
      return true;
    }
    ensureDirectoryExist(dirname);
    fs.mkdirSync(dirname);
  }

  function writeActionFile(template, filePath) {
    if (fs.existsSync(filePath)) {
      logger.info(`file ${filePath} already exists. `);
    } else {
      ensureDirectoryExist(filePath);
      fs.writeFileSync(filePath, Buffer.from(template, 'base64'), {
        mode: CONST.FILE_PERMISSIONS.RWX_R__R__
      });
    }
  }

  _.forEach(actions, (template, actionScriptName) => {
    let extension = actionScriptName.split('.').pop();
    if (extension === actionScriptName) {
      writeActionFile(template, path.join(__dirname, 'fabrik/actions/sh', `${actionScriptName}`));
    } else if (extension === 'js') {
      writeActionFile(template, path.join(__dirname, 'fabrik/actions/js', `${actionScriptName}`));
    } else {
      throw new NotImplemented(`file type ${extension} is not supported`);
    }
  });
}