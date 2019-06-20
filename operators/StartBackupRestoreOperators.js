'use strict';

const DefaultBackupOperator = require('./backup-operator/DefaultBackupOperator');
const defaultBackupOperator = new DefaultBackupOperator();
const DefaultRestoreOperator = require('./restore-operator/DefaultRestoreOperator');
const RestoreStatusPoller = require('./restore-operator/RestoreStatusPoller');
const BackupStatusPoller = require('./backup-operator/BackupStatusPoller');
const BoshRestoreStatusPoller = require('./bosh-restore-operator/BoshRestoreStatusPoller');
const defaultRestoreOperator = new DefaultRestoreOperator();
const DefaultBoshRestoreOperator = require('./bosh-restore-operator/DefaultBoshRestoreOperator');
const defaultBoshRestoreOperator = new DefaultBoshRestoreOperator();
defaultBackupOperator.init();
defaultRestoreOperator.init();
defaultBoshRestoreOperator.init();
/* jshint nonew:false */
new BackupStatusPoller();
/* jshint nonew:false */
new RestoreStatusPoller();
new BoshRestoreStatusPoller();