'use strict';

const Promise = require('bluebird');
const express = require('express');
const expressSession = require('express-session');
const store = require('../../broker/lib/store');
const config = require('../../common/config');
const commonMiddleware = require('../../common/middleware');
const controller = require('../').dashboard;
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
router.use('/manage/dashboards/:instance_type/instances/:instance_id', dashboardRouter);

/* Service Fabrik Instance Router */
instanceRouter.use(commonMiddleware.csp());
instanceRouter.use(controller.handler('validateServiceInstanceId'));
instanceRouter.use(controller.handler('validateSession'));
instanceRouter.use(controller.handler('validateServiceAndPlan'));
instanceRouter.use(controller.handler('requireLogin'));
instanceRouter.use(controller.handler('ensureTokenNotExpired'));
instanceRouter.use(controller.handler('ensureAllNecessaryScopesAreApproved'));
instanceRouter.use(controller.handler('ensureCanManageInstance'));
instanceRouter.route('/')
  .get(controller.handler('show'))
  .all(commonMiddleware.methodNotAllowed(['GET']));

/* Service Fabrik Dashboard Router
   This is for new dashboard URL */
dashboardRouter.use(commonMiddleware.csp());
dashboardRouter.use(controller.handler('validateServiceInstanceId'));
dashboardRouter.use(controller.handler('validateSession'));
dashboardRouter.use(controller.handler('validateServiceInstanceAndType'));
dashboardRouter.use(controller.handler('requireLogin'));
dashboardRouter.use(controller.handler('ensureTokenNotExpired'));
dashboardRouter.use(controller.handler('ensureAllNecessaryScopesAreApproved'));
dashboardRouter.use(controller.handler('ensureCanManageInstance'));
dashboardRouter.route('/')
  .get(controller.handler('show'))
  .all(commonMiddleware.methodNotAllowed(['GET']));