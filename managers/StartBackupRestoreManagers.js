'use strict';

const DefaultBackupManager = require('./backup-manager/DefaultBackupManager');
const defaultBackupManager = new DefaultBackupManager();
const DefaultRestoreManager = require('./restore-manager/DefaultRestoreManager');
const RestoreStatusPoller = require('./restore-manager/RestoreStatusPoller');
const BackupStatusPoller = require('./backup-manager/BackupStatusPoller');
const defaultRestoreManager = new DefaultRestoreManager();
defaultBackupManager.init();
defaultRestoreManager.init();
/* jshint nonew:false */
new BackupStatusPoller();
/* jshint nonew:false */
new RestoreStatusPoller();