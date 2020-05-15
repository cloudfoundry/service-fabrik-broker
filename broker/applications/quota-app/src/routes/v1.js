'use strict';

const express = require('express');
const config = require('@sf/app-config');
const { middleware } = require('@sf/express-commons');
const Controller = require('../QuotaApiController');
const controller = new Controller();
const router = module.exports = express.Router();

router.use(middleware.basicAuth(config.quota_app.username, config.quota_app.password));
router.use(middleware.csp());
router.route('/account/:accountId/quota')
  .get(controller.handler('getQuotaValidStatus'))
  .all(middleware.methodNotAllowed(['GET']));

router.use(middleware.notFound());
router.use(middleware.error({
  defaultFormat: 'json'
}));
