'use strict';

const config = require('../config');
const CloudProviderClient = require('./CloudProviderClient');
const AzureClient = require('./AzureClient');
const BackupStore = require('./BackupStore');
const BackupStoreForServiceInstance = require('./BackupStoreForServiceInstance');
const BackupStoreForOob = require('./BackupStoreForOob');
const BaseCloudClient = require('./BaseCloudClient');
const VirtualHostStore = require('./VirtualHostStore');

const getCloudClient = function (settings) {
  switch (settings.name) {
  case 'azure':
    return new AzureClient(settings);
  default:
    return new CloudProviderClient(settings);
  }
};
const cloudProvider = getCloudClient(config.backup.provider);

exports.CloudProviderClient = CloudProviderClient;
exports.AzureClient = AzureClient;
exports.BackupStore = BackupStore;
exports.BaseCloudClient = BaseCloudClient;
exports.cloudProvider = cloudProvider;
exports.backupStore = new BackupStoreForServiceInstance(cloudProvider);
exports.backupStoreForOob = new BackupStoreForOob(cloudProvider);

const virtualHostCloudProvider = getCloudClient(config.virtual_host.provider);
exports.virtualHostStore = new VirtualHostStore(virtualHostCloudProvider);