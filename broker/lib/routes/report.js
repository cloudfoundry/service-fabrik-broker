'use strict';

const express = require('express');
const config = require('../config');
const common_middleware = require('../../../common/middleware');
const controller = require('../controllers').serviceFabrikReport;
const router = module.exports = express.Router();

router.use(common_middleware.basicAuth(config.username, config.password));
router.use(common_middleware.csp());
router.route('/backups/summary/:instance_id')
  .get(controller.handler('getServiceInstanceBackupSummary'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/backups/scheduled_instances')
  .get(controller.handler('getScheduledBackupInstances'))
  .all(common_middleware.methodNotAllowed(['GET']));

router.use(common_middleware.notFound());
router.use(common_middleware.error({
  defaultFormat: 'json'
}));