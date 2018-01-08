'use strict';

const express = require('express');
const config = require('../config');
const middleware = require('../middleware');
const controller = require('../controllers').serviceFabrikReport;
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