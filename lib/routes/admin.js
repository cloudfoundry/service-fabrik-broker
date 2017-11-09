'use strict';

const express = require('express');
const config = require('../config');
const middleware = require('../middleware');
const CONST = require('../constants');
const controller = require('../controllers').serviceFabrikAdmin;

const router = module.exports = express.Router();

router.use(middleware.basicAuth(config.username, config.password));
router.use(middleware.csp());
router.route('/deployments/outdated')
  .get(controller.handler('getOutdatedDeployments'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/deployments/outdated/update')
  .post(controller.handler('updateOutdatedDeployments'))
  .all(middleware.methodNotAllowed(['POST']));
router.route('/deployments')
  .get(controller.handler('getDeployments'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/deployments/summary')
  .get(controller.handler('getDeploymentsSummary'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name')
  .get(controller.handler('getDeployment'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/update')
  .post(controller.handler('updateDeployment'))
  .all(middleware.methodNotAllowed(['POST']));
router.route('/backups')
  .get(controller.handler('getListOfBackups'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/backups/:backup_guid/delete')
  .post(controller.handler('deleteBackup'))
  .all(middleware.methodNotAllowed(['POST']));
router.route('/backups/report-backup/:instance_id/:start_time/:end_time')
  .get(controller.handler('reportBackupSummary'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/service-fabrik/db')
  .post(controller.handler('provisionDataBase'))
  .put(controller.handler('updateDatabaseDeployment'))
  .get(controller.handler('getDatabaseInfo'))
  .all(middleware.methodNotAllowed(['GET', 'POST', 'PUT']));
router.route('/deployments/:name/schedule_backup')
  .all(middleware.isFeatureEnabled(CONST.FEATURE.SCHEDULED_OOB_DEPLOYMENT_BACKUP))
  .put(controller.handler('scheduleOobBackup'))
  .get(controller.handler('getOobBackupSchedule'))
  .delete(controller.handler('cancelOobScheduledBackup'))
  .all(middleware.methodNotAllowed(['PUT', 'GET', 'DELETE']));
router.route('/deployments/:name/backup')
  .post(controller.handler('startOobBackup'))
  .get(controller.handler('getOobBackup'))
  .all(middleware.methodNotAllowed(['GET', 'POST']));
router.route('/deployments/:name/backup/status')
  .get(controller.handler('getLastOobBackupStatus'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/director')
  .get(controller.handler('getDeploymentDirectorConfig'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/restore')
  .post(controller.handler('startOobRestore'))
  .get(controller.handler('getOobRestore'))
  .all(middleware.methodNotAllowed(['GET', 'POST']));
router.route('/deployments/:name/restore/status')
  .get(controller.handler('getLastOobRestoreStatus'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/service-fabrik/maintenance/history')
  .get(controller.handler('getMaintenanceHistory'))
  .all(middleware.methodNotAllowed(['GET']));
router.route('/service-fabrik/maintenance')
  .post(controller.handler('startMaintenance'))
  .put(controller.handler('updateMaintenance'))
  .get(controller.handler('getMaintenance'))
  .all(middleware.methodNotAllowed(['GET', 'POST', 'PUT']));


router.use(middleware.notFound());
router.use(middleware.error({
  defaultFormat: 'json'
}));