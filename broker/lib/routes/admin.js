'use strict';

const express = require('express');
const config = require('../config');
const middleware = require('../middleware');
const common_middleware = require('../../../common/middleware');
const CONST = require('../constants');
const controller = require('../controllers').serviceFabrikAdmin;

const router = module.exports = express.Router();

router.use(common_middleware.basicAuth(config.username, config.password));
router.use(common_middleware.csp());
router.route('/deployments/outdated')
  .get(controller.handler('getOutdatedDeployments'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/deployments/outdated/update')
  .post(controller.handler('updateOutdatedDeployments'))
  .all(common_middleware.methodNotAllowed(['POST']));
router.route('/deployments')
  .get(controller.handler('getDeployments'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/deployments/summary')
  .get(controller.handler('getDeploymentsSummary'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name')
  .get(controller.handler('getDeployment'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/update')
  .post(controller.handler('updateDeployment'))
  .all(common_middleware.methodNotAllowed(['POST']));
router.route('/backups')
  .get(controller.handler('getListOfBackups'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/backups/:backup_guid/delete')
  .post(controller.handler('deleteBackup'))
  .all(common_middleware.methodNotAllowed(['POST']));
router.route('/service-fabrik/db')
  .post(controller.handler('provisionDataBase'))
  .put(controller.handler('updateDatabaseDeployment'))
  .get(controller.handler('getDatabaseInfo'))
  .all(common_middleware.methodNotAllowed(['GET', 'POST', 'PUT']));
router.route('/deployments/:name/schedule_backup')
  .all(middleware.isFeatureEnabled(CONST.FEATURE.SCHEDULED_OOB_DEPLOYMENT_BACKUP))
  .put(controller.handler('scheduleOobBackup'))
  .get(controller.handler('getOobBackupSchedule'))
  .delete(controller.handler('cancelOobScheduledBackup'))
  .all(common_middleware.methodNotAllowed(['PUT', 'GET', 'DELETE']));
router.route('/deployments/:name/backup')
  .post(controller.handler('startOobBackup'))
  .get(controller.handler('getOobBackup'))
  .all(common_middleware.methodNotAllowed(['GET', 'POST']));
router.route('/deployments/:name/backup/status')
  .get(controller.handler('getLastOobBackupStatus'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/director')
  .get(controller.handler('getDeploymentDirectorConfig'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/restore')
  .post(controller.handler('startOobRestore'))
  .get(controller.handler('getOobRestore'))
  .all(common_middleware.methodNotAllowed(['GET', 'POST']));
router.route('/deployments/:name/restore/status')
  .get(controller.handler('getLastOobRestoreStatus'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/service-fabrik/maintenance/history')
  .get(controller.handler('getMaintenanceHistory'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.route('/service-fabrik/maintenance')
  .post(controller.handler('startMaintenance'))
  .put(controller.handler('updateMaintenance'))
  .get(controller.handler('getMaintenance'))
  .all(common_middleware.methodNotAllowed(['GET', 'POST', 'PUT']));


router.use(common_middleware.notFound());
router.use(common_middleware.error({
  defaultFormat: 'json'
}));