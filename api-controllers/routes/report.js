'use strict';

const express = require('express');
const config = require('../../common/config');
const commonMiddleware = require('../../common/middleware');
const controller = require('../').serviceFabrikReport;
const router = module.exports = express.Router();

router.use(commonMiddleware.basicAuth(config.username, config.password));
router.use(commonMiddleware.csp());
router.route('/backups/summary/:instance_id')
  .get(controller.handler('getServiceInstanceBackupSummary'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/backups/scheduled_instances')
  .get(controller.handler('getScheduledBackupInstances'))
  .all(commonMiddleware.methodNotAllowed(['GET']));

router.use(commonMiddleware.notFound());
router.use(commonMiddleware.error({
  defaultFormat: 'json'
}));