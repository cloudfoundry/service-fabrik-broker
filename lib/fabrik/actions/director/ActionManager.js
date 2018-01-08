'use strict';

const fs = require('fs');
const Promise = require('bluebird');
const path = require('path');
const logger = require('../../../logger');
const errors = require('../../../errors');
const ScriptExecutor = require('../../../utils/ScriptExecutor');

class ActionManager {
  static getAction(phase, action) {
    try {
      const actionProcessor = require(`./${action}`);
      let actionHandler = actionProcessor[`execute${phase}`];
      if (typeof actionHandler !== 'function') {
        logger.info(`action ${action} for phase ${phase} undefined in the JS : ${action}. Void implementation is being returned back`);
        actionHandler = () => {
          logger.warn(`Not implemented {phase} for ${action}`);
          return Promise.resolve(0);
        };
      }
      const execute = function () {
        return actionHandler.apply(actionProcessor, arguments);
      };
      return execute;
    } catch (err) {
      const actionScriptAbsPath = path.join(__dirname, '..', 'bin/actions/director', `${action}_${phase}`);
      if (fs.existsSync(actionScriptAbsPath)) {
        logger.info(`action ${action} for phase ${phase} is defined in the script ${action}_${phase}`);
        return new ScriptExecutor(actionScriptAbsPath).execute;
      }
      logger.error(`action ${action} for phase ${phase} undefined`);
      throw new errors.NotImplemented(`Not implemented {phase} for ${action}`);
    }
  }
}

module.exports = ActionManager;