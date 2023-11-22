'use strict';

const crypto = require('crypto');
const _ = require('lodash');
const yaml = require('js-yaml');
const Promise = require('bluebird');
const assert = require('assert');
const Session = require('express-session').Session;
const config = require('@sf/app-config');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    Forbidden,
    ContinueWithNext,
    NotFound
  },
  commonFunctions: {
    decodeBase64,
    parseToken
  }
} = require('@sf/common-utils');
const { catalog } = require('@sf/models');
const { apiServerClient } = require('@sf/eventmesh');
const cf = require('@sf/cf');
const {
  FabrikBaseController
} = require('@sf/common-controllers');

const DirectorService = require('@sf/provisioner-services').DirectorService;
const VirtualHostService = require('../../../operators/src/virtualhost-operator/VirtualHostService');

Promise.promisifyAll(crypto, Session.prototype);

class DashboardController extends FabrikBaseController {
  constructor() {
    super();
    this.cloudController = cf.cloudController;
    this.uaa = cf.uaa;
  }

  show(req, res) {
    const managerType = req.service.plan.manager.name;
    return req.service
      .getInfo()
      .then(info => {
        let additional_info = {};
        if (req.service.plan.manager.settings.dashboard_template) {
          additional_info = yaml.load(_.template(Buffer.from(req.service.plan.manager.settings.dashboard_template, 'base64'))(info));
        }
        info = _.assign({
          userId: req.session.user_id,
          customAttrs: additional_info
        }, info);

        function sendJson() {
          res.send(info);
        }

        function renderHtml() {
          res.render(`dashboard-${managerType}`, info);
        }
        res.format({
          html: renderHtml,
          json: sendJson,
          default: renderHtml
        });
      });
  }

  redirectToAuthorizationServer(req, res) {
    const dashboardClient = catalog.getService(req.session.service_id).dashboard_client;
    return Promise
      .try(() => {
        if (!req.session.state) {
          return saveSession(req.session);
        }
      })
      .then(() => ({
        client_id: dashboardClient.id,
        redirect_uri: dashboardClient.redirect_uri,
        scope: ['cloud_controller_service_permissions.read', 'openid'],
        state: req.session.state
      }))
      .tap(query => logger.info('Redirecting to authorization server with query parameters:', query))
      .then(query => res.redirect(this.uaa.authorizationUrl(query, req.session.login_hint)));
  }

  handleAuthorizationResponse(req, res) {
    logger.info(`Handling authorization response with code '${req.query.code}'`);
    logger.info(`Session '${req.session.id}'`, req.session);
    const service = catalog.getService(req.session.service_id);
    if (req.query.state !== req.session.state) {
      const err = new Forbidden('Invalid state parameter in response to authorization request');
      logger.error(err.message, {
        act: req.query.state,
        exp: req.session.state
      });
      throw err;
    }
    return this.uaa
      .accessWithAuthorizationCode(service.dashboard_client, req.query.code)
      .then(result => {
        req.session.access_token = result.access_token;
        req.session.last_seen = Date.now();
        return this.uaa.userInfo(result.access_token);
      })
      .then(userInfo => {
        logger.debug('User Information returned from the Authorization Server', userInfo);
        req.session.user_id = userInfo.user_name || userInfo.email || userInfo.user_id;
        return saveSession(req.session);
      })
      .then(() => res.redirect(manageInstancePath(req.session)));
  }

  validateServiceInstanceId(req, res) {
    /* jshint unused:false */
    logger.info(`Validating service instance ID '${req.params.instance_id}'`);
    this.validateUuid(req.params.instance_id, 'Service Instance ID');
    throw new ContinueWithNext();
  }

  validateSession(req, res) {
    /* jshint unused:false */
    logger.info(`Validating session '${req.session.id}'`);
    if ((!req.session.service_id || req.session.service_id === req.params.service_id) || (!req.session.instance_type || req.session.instance_type === req.params.instance_type) || (!req.session.login_hint || req.session.login_hint === req.query.login_hint || req.session.login_hint === 'sap.ids')) {
      throw new ContinueWithNext();
    }
    logger.info('Regenerating session...');
    return req.session
      .regenerateAsync()
      .tap(() => logger.info(`Regenerated session '${req.session.id}'`))
      .throw(new ContinueWithNext());
  }

  validateServiceAndPlan(req, res) {
    /* jshint unused:false */
    const instance_id = req.params.instance_id;
    const service_id = req.params.service_id;
    const plan_id = req.params.plan_id;
    const encodedOp = _.get(req, 'query.operation', undefined);
    const operation = encodedOp === undefined ? null : decodeBase64(encodedOp);
    const context = _.get(req, 'body.context') || _.get(operation, 'context');
    logger.info(`Validating service '${service_id}' and plan '${plan_id}'`);
    return this.cloudController.getPlanIdFromInstanceId(instance_id)
      .then(current_plan_id => {
        logger.info(`plan_id in Dashboard URL was ${plan_id} and actual plan_id is ${current_plan_id}`);
        return createService(current_plan_id, instance_id, context);
      })
      .then(service => {
        req.service = service;
      })
      .throw(new ContinueWithNext());
  }

  validateServiceInstanceAndType(req, res) {
    /* jshint unused:false */
    const instance_id = req.params.instance_id;
    const instance_type = req.params.instance_type;
    /* TODO: Conditional statement to fetch resourceOptions below is needed to be backwards compatible 
     as appliedOptions was added afterwards. Should be removed once all the older resources are updated. */
    return this._getApiServerResource(instance_id, instance_type)
      .then(resource => _.get(resource, 'status.appliedOptions') ? _.get(resource, 'status.appliedOptions') : _.get(resource, 'spec.options'))
      .then(resourceOptions => {
        const service_id = _.get(resourceOptions, 'service_id');
        const plan_id = _.get(resourceOptions, 'plan_id');
        const context = _.get(resourceOptions, 'context');
        req.session.service_id = service_id;
        req.session.plan_id = plan_id;
        return createService(plan_id, instance_id, context);
      })
      .then(service => {
        req.service = service;
      })
      .then(() => saveSession(req.session))
      .throw(new ContinueWithNext());
  }

  _getApiServerResource(instance_id, instance_type) {
    let resourceType;
    switch (instance_type) {
      case CONST.INSTANCE_TYPE.DIRECTOR:
        resourceType = CONST.APISERVER.RESOURCE_TYPES.DIRECTOR;
        break;
      case CONST.INSTANCE_TYPE.VIRTUAL_HOST:
        resourceType = CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST;
        break;
      default:
        throw new NotFound(`Resource doesn't exist for instance type ${instance_type}`);
    }
    return apiServerClient.getResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: resourceType,
      resourceId: instance_id
    });
  }

  requireLogin(req, res) {
    logger.info(`Validating user '${req.session.user_id}' and access token`);
    req.session.service_id = req.params.service_id || req.session.service_id;
    req.session.plan_id = req.params.plan_id || req.session.plan_id;
    req.session.instance_id = req.params.instance_id;
    req.session.instance_type = req.params.instance_type;
    if (req.query.login_hint) {
      req.session.login_hint = req.query.login_hint;
    } else {
      req.session.login_hint = 'sap.ids';
    }
    const oldestAllowableLastSeen = Date.now() - config.external.session_expiry * 1000;
    if (req.session.user_id && req.session.access_token && req.session.last_seen > oldestAllowableLastSeen) {
      req.session.last_seen = Date.now();
      throw new ContinueWithNext();
    }
    if (!req.session.user_id) {
      logger.debug(`No User ID could be found in session ${req.sessionID}`);
    } else if (!req.session.access_token) {
      logger.debug(`No Access Token could be found in session ${req.sessionID}`);
    } else {
      logger.debug(`Last seen ${req.session.last_seen} of session ${req.sessionID} is to old`);
    }
    return saveSession(req.session)
      .then(() => res.redirect('/manage/auth/cf'));
  }

  ensureTokenNotExpired(req, res) {
    const token = parseToken(req.session.access_token)[1];
    if (Date.now() < token.exp * 1000) {
      throw new ContinueWithNext();
    }
    return saveSession(req.session)
      .then(() => res.redirect('/manage/auth/cf'));
  }

  ensureAllNecessaryScopesAreApproved(req, res) {
    const token = parseToken(req.session.access_token)[1];
    if (!_.difference(this.constructor.necessaryScopes, token.scope).length) {
      throw new ContinueWithNext();
    }
    if (req.session.has_retried) {
      req.session.has_retried = false;
      const message = 'You do not have approved the permissions this application requires in order to manage the requested service instance.';
      throw new Forbidden(message);
    }
    req.session.has_retried = true;
    return saveSession(req.session)
      .then(() => res.redirect('/manage/auth/cf'));
  }

  ensureCanManageInstance(req, res) {
    /* jshint unused:false */
    const options = {
      auth: {
        bearer: req.session.access_token
      }
    };
    return this.cloudController
      .getServiceInstancePermissions(req.params.instance_id, options)
      .then(permissions => {
        logger.info(`User '${req.session.user_id}' has permissions ${JSON.stringify(permissions)}`);
        if (!permissions.manage) {
          throw new Forbidden('You do not have sufficient permissions for the space containing the requested service instance.');
        }
      })
      .throw(new ContinueWithNext());
  }
}

DashboardController.necessaryScopes = ['openid', 'cloud_controller_service_permissions.read'];

function saveSession(session) {
  return Promise
    .try(() => {
      if (!session.state) {
        return crypto
          .randomBytesAsync(16)
          .then(buffer => (session.state = buffer.toString('hex')))
          .return(session);
      }
      return session;
    })
    .tap(() => session.saveAsync());
}

function manageInstancePath(session) {
  return session.instance_type ? `/manage/dashboards/${session.instance_type}/instances/${session.instance_id}?login_hint=${session.login_hint}` : `/manage/instances/${session.service_id}/${session.plan_id}/${session.instance_id}?login_hint=${session.login_hint}`;
}

function createService(plan_id, instance_id, context) {
  const plan = catalog.getPlan(plan_id);
  const options = {
    plan_id: plan_id,
    context: context
  };
  switch (plan.manager.name) {
    case CONST.INSTANCE_TYPE.DIRECTOR:
      return DirectorService.createInstance(instance_id, options);
    case CONST.INSTANCE_TYPE.VIRTUAL_HOST:
      return VirtualHostService.createVirtualHostService(instance_id, options);
    default:
      assert.fail(plan.manager.name, [CONST.INSTANCE_TYPE.DIRECTOR, CONST.INSTANCE_TYPE.VIRTUAL_HOST], undefined, 'in');
  }
}

module.exports = DashboardController;
