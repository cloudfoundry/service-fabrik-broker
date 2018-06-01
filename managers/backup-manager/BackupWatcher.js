const DefaultBackupManager = require('./DefaultBackupManager');
const DBManager = require('../../broker/lib/fabrik/DBManager');

new DBManager();
let defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher();