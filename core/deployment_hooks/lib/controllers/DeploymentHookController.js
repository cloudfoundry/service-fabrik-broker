'use strict';


const errors = require('../errors');
const logger = require('../logger');
const BadRequest = errors.BadRequest;
const HookBaseController = require('./HookBaseController');
const ActionManager = require('../actions/ActionManager');

class DeploymentHookController extends HookBaseController {
  constructor() {
    super();
  }
  // Method for getting action response
  executeActions(req, res) {
    if (!req.body.phase || !req.body.actions) {
      throw new BadRequest('Deployment phase and actions are required');
    }
    return ActionManager
      .executeActions(req.body.phase, req.body.actions, req.body.context)
      .tap(body => logger.info('Sending response body: ', body))
      .then(body => res
        .status(200)
        .send(body));
  }
}

module.exports = DeploymentHookController;
