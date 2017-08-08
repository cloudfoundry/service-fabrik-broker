'use strict';

const config = require('../config');
const CloudProviderClient = require('./CloudProviderClient');
const BackupStore = require('./BackupStore');
const BackupStoreForServiceInstance = require('./BackupStoreForServiceInstance');
const BackupStoreForOob = require('./BackupStoreForOob');

const cloudProvider = new CloudProviderClient(config.backup.provider);


exports.CloudProviderClient = CloudProviderClient;
exports.BackupStore = BackupStore;
exports.cloudProvider = cloudProvider;
exports.backupStore = new BackupStoreForServiceInstance(cloudProvider);
exports.backupStoreForOob = new BackupStoreForOob(cloudProvider);