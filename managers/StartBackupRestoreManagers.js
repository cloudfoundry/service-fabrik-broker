'use strict';

const DefaultBackupManager = require('./backup-manager/DefaultBackupManager');
const defaultBackupManager = new DefaultBackupManager();
const DefaultRestoreManager = require('./backup-manager/DefaultRestoreManager');
const defaultRestoreManager = new DefaultRestoreManager();
defaultBackupManager.init();
defaultRestoreManager.init();