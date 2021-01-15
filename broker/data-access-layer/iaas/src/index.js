'use strict';

const config = require('@sf/app-config');
const AwsClient = require('./AwsClient');
const AzureClient = require('./AzureClient');
const GcpClient = require('./GcpClient');
const AliClient = require('./AliClient');
const BackupStore = require('./BackupStore');
const BackupStoreForServiceInstance = require('./BackupStoreForServiceInstance');
const BackupStoreForOob = require('./BackupStoreForOob');
const BaseCloudClient = require('./BaseCloudClient');
const MeteringArchiveStore = require('./MeteringArchiveStore');
// Modifying CloudProviderClient variable as we are moving the pkgcloud to dev dependency and we dont use openstack in our production.
// In production, it should be BaseCloudClient and in dev env its usual CloudProviderClient which uses pkgcloud.
const CloudProviderClient = (process.env.NODE_ENV !== 'production') ? require('./CloudProviderClient') : BaseCloudClient;

const getCloudClient = function (settings) {
  switch (settings.name) {
    case 'azure':
      return new AzureClient(settings);
    case 'gcp':
      return new GcpClient(settings);
    case 'aws':
      return new AwsClient(settings);
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
exports.AwsClient = AwsClient;
exports.AzureClient = AzureClient;
exports.GcpClient = GcpClient;
exports.AliClient = AliClient;
exports.BackupStore = BackupStore;
exports.BaseCloudClient = BaseCloudClient;
exports.cloudProvider = cloudProvider;
exports.backupStore = new BackupStoreForServiceInstance(cloudProvider);
exports.backupStoreForOob = new BackupStoreForOob(cloudProvider);
exports.meteringArchiveStore = new MeteringArchiveStore(cloudProvider);
