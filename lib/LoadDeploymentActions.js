'use strict';

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const NotImplemented = require('./errors').NotImplemented;
const CONST = require('./constants');
const config = require('./config');

loadActionScripts(config.actions);
process.exit(0);

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
    if (!fs.existsSync(filePath)) {
      ensureDirectoryExist(filePath);
      fs.writeFileSync(filePath, Buffer.from(template, 'base64'), {
        mode: CONST.FILE_PERMISSIONS.RWXR_XR_X
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