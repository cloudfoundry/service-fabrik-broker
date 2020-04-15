'use strict';

const express = require('express');
const config = require('@sf/app-config');
const { middleware } = require('@sf/express-commons');
const controller = require('./api-controllers').serviceFabrikReport;
require('@sf/express-commons').middleware.enableAbsMatchingRouteLookup(express);

const router = module.exports = express.Router();

router.use(middleware.basicAuth(config.username, config.password));
router.use(middleware.csp());
router.route('/backups/summary/:instance_id')
  .get(controller.handler('getServiceInstanceBackupSummary'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/backups/scheduled_instances')
  .get(controller.handler('getScheduledBackupInstances'))
  .all(middleware.methodNotAllowed(['GET']));

router.use(middleware.notFound());
router.use(middleware.error({
  defaultFormat: 'json'
}));
