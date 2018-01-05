'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../../logger');
const errors = require('../../../errors');
const ScriptExecutor = require('../../../utils/ScriptExecutor');

class ActionManager {
  static getAction(phase, action) {
    try {
      return require(`./${action}`);
    } catch (err) {
      const actionScriptAbsPath = path.join(__dirname, '..', 'bin/actions/director', `${action}_${phase}`);
      if (fs.existsSync(actionScriptAbsPath)) {
        return new ScriptExecutor(actionScriptAbsPath);
      }
      logger.error(`action ${action} for phase ${phase} undefined`);
      throw new errors.NotImplemented(`Predeploy action ${action} not implemented`);
    }
  }
}

module.exports = ActionManager;