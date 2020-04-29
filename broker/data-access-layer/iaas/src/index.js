'use strict';

const config = require('@sf/app-config');
const CloudProviderClient = require('./CloudProviderClient');
const AzureClient = require('./AzureClient');
const GcpClient = require('./GcpClient');
const AliClient = require('./AliClient');
const BackupStore = require('./BackupStore');
const BackupStoreForServiceInstance = require('./BackupStoreForServiceInstance');
const BackupStoreForOob = require('./BackupStoreForOob');
const BaseCloudClient = require('./BaseCloudClient');
const MeteringArchiveStore = require('./MeteringArchiveStore');

const getCloudClient = function (settings) {
  switch (settings.name) {
    case 'azure':
      return new AzureClient(settings);
    case 'gcp':
      return new GcpClient(settings);
    case 'aws':
    case 'openstack':
    case 'os':
      return new CloudProviderClient(settings);
    case 'ali':
      return new AliClient(settings);
    default:
      return new BaseCloudClient(settings);
  }
};
const cloudProvider = getCloudClient(config.backup.provider);

exports.CloudProviderClient = CloudProviderClient;
exports.AzureClient = AzureClient;
exports.GcpClient = GcpClient;
exports.AliClient = AliClient;
exports.BackupStore = BackupStore;
exports.BaseCloudClient = BaseCloudClient;
exports.cloudProvider = cloudProvider;
exports.backupStore = new BackupStoreForServiceInstance(cloudProvider);
exports.backupStoreForOob = new BackupStoreForOob(cloudProvider);
exports.meteringArchiveStore = new MeteringArchiveStore(cloudProvider);
