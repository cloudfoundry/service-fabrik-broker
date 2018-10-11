'use strict';

const DefaultBackupOperator = require('./backup-operator/DefaultBackupOperator');
const defaultBackupOperator = new DefaultBackupOperator();
const DefaultRestoreOperator = require('./restore-manager/DefaultRestoreOperator');
const RestoreStatusPoller = require('./restore-manager/RestoreStatusPoller');
const BackupStatusPoller = require('./backup-operator/BackupStatusPoller');
const defaultRestoreOperator = new DefaultRestoreOperator();
defaultBackupOperator.init();
defaultRestoreOperator.init();
/* jshint nonew:false */
new BackupStatusPoller();
/* jshint nonew:false */
new RestoreStatusPoller();