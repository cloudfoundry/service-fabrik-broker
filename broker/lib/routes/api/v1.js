'use strict';

const express = require('express');
const middleware = require('../../middleware');
const commonMiddleware = require('../../../../common/middleware');
const CONST = require('../../constants');
const controller = require('../../controllers').serviceFabrikApi;

const router = module.exports = express.Router();
const instanceRouter = express.Router({
  mergeParams: true
});
const backupRouter = express.Router();
const operationRouter = express.Router({
  mergeParams: true
});

/* Service Fabrik API Router */
router.route('/info')
  .get(controller.handler('getInfo'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.use(controller.handler('verifyAccessToken'));
router.use('/service_instances/:operation(backup|restore)', operationRouter);
router.use('/service_instances/:instance_id', instanceRouter);
router.use('/backups', backupRouter);
router.use(commonMiddleware.notFound());
router.use(commonMiddleware.error({
  defaultFormat: 'json'
}));

/* Service Instances Router */
operationRouter.use(controller.handler('verifyTenantPermission'));
operationRouter.route('/')
  .get(controller.handler('listLastOperationOfAllInstances'))
  .all(commonMiddleware.methodNotAllowed(['GET']));

/* Service Instance Router */
instanceRouter.use(controller.handler('verifyTenantPermission'));
instanceRouter.use(controller.handler('assignManager'));
instanceRouter.route('/')
  .get(controller.handler('getServiceInstanceState'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
instanceRouter.route('/backup')
  .post(controller.handler('startBackup'))
  .get(controller.handler('getLastBackup'))
  .delete(controller.handler('abortLastBackup'))
  .all(commonMiddleware.methodNotAllowed(['POST', 'GET', 'DELETE']));
instanceRouter.route('/schedule_backup')
  .all(middleware.isFeatureEnabled(CONST.FEATURE.SCHEDULED_BACKUP))
  .put(controller.handler('scheduleBackup'))
  .get(controller.handler('getBackupSchedule'))
  .delete(controller.handler('cancelScheduledBackup'))
  .all(commonMiddleware.methodNotAllowed(['PUT', 'GET', 'DELETE']));
instanceRouter.route('/restore')
  .post(controller.handler('startRestore'))
  .get(controller.handler('getLastRestore'))
  .delete(controller.handler('abortLastRestore'))
  .all(commonMiddleware.methodNotAllowed(['POST', 'GET', 'DELETE']));
instanceRouter.route('/schedule_update')
  .all(middleware.isFeatureEnabled(CONST.FEATURE.SCHEDULED_UPDATE))
  .put(controller.handler('scheduleUpdate'))
  .get(controller.handler('getUpdateSchedule'))
  .all(commonMiddleware.methodNotAllowed(['PUT', 'GET']));

/* Backup Router */
backupRouter.use(controller.handler('verifyTenantPermission'));
backupRouter.route('/')
  .get(controller.handler('listBackups'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
backupRouter.route('/:backup_guid')
  .get(controller.handler('getBackup'))
  .delete(controller.handler('deleteBackup'))
  .all(commonMiddleware.methodNotAllowed(['GET', 'DELETE']));