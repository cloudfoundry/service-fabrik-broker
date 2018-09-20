'use strict';

const DefaultBackupManager = require('./backup-manager/DefaultBackupManager');
const defaultBackupManager = new DefaultBackupManager();
const DefaultRestoreManager = require('./restore-manager/DefaultRestoreManager');
const RestoreTaskPoller = require('./restore-manager/RestoreTaskPoller');
const BackupStatusPoller = require('./backup-manager/BackupStatusPoller');
const defaultRestoreManager = new DefaultRestoreManager();
defaultBackupManager.init();
defaultRestoreManager.init();
RestoreTaskPoller.start();
BackupStatusPoller.start();