'use strict';

const DefaultBackupManager = require('./backup-manager/DefaultBackupManager');
const defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.init();