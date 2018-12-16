'use strict';

const Agent = require('../../../data-access-layer/service-agent');
const DBManager = require('./DBManager');
const OobBackupManager = require('./OobBackupManager');

Fabrik.Agent = Agent;
Fabrik.dbManager = new DBManager();
Fabrik.oobBackupManager = OobBackupManager;
module.exports = Fabrik;