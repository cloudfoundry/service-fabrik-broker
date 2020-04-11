'use strict';

const Promise = require('bluebird');
const express = require('express');
const expressSession = require('express-session');

const store = require('./store');
const config = require('@sf/app-config');
const { middleware } = require('@sf/express-commons');
const controller = require('../../').dashboard;
Promise.promisifyAll(expressSession.Session.prototype);

const cfg = config.external;

const router = module.exports = express.Router();
const instanceRouter = express.Router({
  mergeParams: true
});
const dashboardRouter = express.Router({
  mergeParams: true
});

/* Service Fabrik Manage Router */
router.use(expressSession({
  store: store,
  name: 'JSESSIONID',
  secret: cfg.cookie_secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    path: '/manage',
    httpOnly: true,
    secure: !!cfg.cookie_secure,
    maxAge: cfg.session_expiry * 1000
  }
}));
router.get('/auth/cf', controller.handler('redirectToAuthorizationServer'));
router.get('/auth/cf/callback', controller.handler('handleAuthorizationResponse'));
router.use('/instances/:service_id/:plan_id/:instance_id', instanceRouter);
router.use('/dashboards/:instance_type/instances/:instance_id', dashboardRouter);

/* Service Fabrik Instance Router */
instanceRouter.use(middleware.csp());
instanceRouter.use(controller.handler('validateServiceInstanceId'));
instanceRouter.use(controller.handler('validateSession'));
instanceRouter.use(controller.handler('validateServiceAndPlan'));
instanceRouter.use(controller.handler('requireLogin'));
instanceRouter.use(controller.handler('ensureTokenNotExpired'));
instanceRouter.use(controller.handler('ensureAllNecessaryScopesAreApproved'));
instanceRouter.use(controller.handler('ensureCanManageInstance'));
instanceRouter.route('/')
  .get(controller.handler('show'))
  .all(middleware.methodNotAllowed(['GET']));

/* Service Fabrik Dashboard Router
   This is for new dashboard URL */
dashboardRouter.use(middleware.csp());
dashboardRouter.use(controller.handler('validateServiceInstanceId'));
dashboardRouter.use(controller.handler('validateSession'));
dashboardRouter.use(controller.handler('validateServiceInstanceAndType'));
dashboardRouter.use(controller.handler('requireLogin'));
dashboardRouter.use(controller.handler('ensureTokenNotExpired'));
dashboardRouter.use(controller.handler('ensureAllNecessaryScopesAreApproved'));
dashboardRouter.use(controller.handler('ensureCanManageInstance'));
dashboardRouter.route('/')
  .get(controller.handler('show'))
  .all(middleware.methodNotAllowed(['GET']));
