'use strict';

const express = require('express');
const config = require('../../common/config');
const middleware = require('../../broker/lib/middleware');
const commonMiddleware = require('../../common/middleware');
const CONST = require('../../common/constants');
const controller = require('../').serviceFabrikAdmin;

const router = module.exports = express.Router();

router.use(commonMiddleware.basicAuth(config.username, config.password));
router.use(commonMiddleware.csp());
router.route('/deployments/outdated')
  .get(controller.handler('getOutdatedDeployments'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/deployments/outdated/update')
  .post(controller.handler('updateOutdatedDeployments'))
  .all(commonMiddleware.methodNotAllowed(['POST']));
router.route('/deployments')
  .get(controller.handler('getDeployments'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/deployments/summary')
  .get(controller.handler('getDeploymentsSummary'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/deployments/:name')
  .get(controller.handler('getDeployment'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/update')
  .post(controller.handler('updateDeployment'))
  .all(commonMiddleware.methodNotAllowed(['POST']));
router.route('/backups')
  .get(controller.handler('getListOfBackups'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/backups/:backup_guid/delete')
  .post(controller.handler('deleteBackup'))
  .all(commonMiddleware.methodNotAllowed(['POST']));
router.route('/service-fabrik/db')
  .post(controller.handler('provisionDataBase'))
  .put(controller.handler('updateDatabaseDeployment'))
  .get(controller.handler('getDatabaseInfo'))
  .all(commonMiddleware.methodNotAllowed(['GET', 'POST', 'PUT']));
router.route('/deployments/:name/schedule_backup')
  .all(middleware.isFeatureEnabled(CONST.FEATURE.SCHEDULED_OOB_DEPLOYMENT_BACKUP))
  .put(controller.handler('scheduleOobBackup'))
  .get(controller.handler('getOobBackupSchedule'))
  .delete(controller.handler('cancelOobScheduledBackup'))
  .all(commonMiddleware.methodNotAllowed(['PUT', 'GET', 'DELETE']));
router.route('/deployments/:name/backup')
  .post(controller.handler('startOobBackup'))
  .get(controller.handler('getOobBackup'))
  .all(commonMiddleware.methodNotAllowed(['GET', 'POST']));
router.route('/deployments/:name/backup/status')
  .get(controller.handler('getLastOobBackupStatus'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/director')
  .get(controller.handler('getDeploymentDirectorConfig'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/deployments/:name/restore')
  .post(controller.handler('startOobRestore'))
  .get(controller.handler('getOobRestore'))
  .all(commonMiddleware.methodNotAllowed(['GET', 'POST']));
router.route('/deployments/:name/restore/status')
  .get(controller.handler('getLastOobRestoreStatus'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/service-fabrik/maintenance/history')
  .get(controller.handler('getMaintenanceHistory'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.route('/service-fabrik/maintenance')
  .post(controller.handler('startMaintenance'))
  .put(controller.handler('updateMaintenance'))
  .get(controller.handler('getMaintenance'))
  .all(commonMiddleware.methodNotAllowed(['GET', 'POST', 'PUT']));
router.route('/update/schedules')
  .get(controller.handler('getScheduledUpdateInstances'))
  .all(commonMiddleware.methodNotAllowed(['GET']));


router.use(commonMiddleware.notFound());
router.use(commonMiddleware.error({
  defaultFormat: 'json'
}));