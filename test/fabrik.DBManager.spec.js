'use strict';

const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const _ = require('lodash');
const BoshDirectorClient = require('../lib/bosh/BoshDirectorClient');
const errors = require('../lib/errors');
const BackupStore = require('../lib/iaas/BackupStoreForServiceInstance');
const Agent = require('../lib/fabrik/Agent');
const CONST = require('../lib/constants');

const DirectorManagerStub = {
  getBindingProperty: function () {
    return Promise.resolve({
      credentials: {
        uri: 'mongodb://username:password@10.11.0.2:27017,10.11.0.3:27017,10.11.0.4:27017/service-fabrik'
      }
    });
  },
  createBinding: () => Promise.resolve({
    credentials: {
      uri: 'mongodb://username:password@10.11.0.2:27017,10.11.0.3:27017,10.11.0.4:27017/service-fabrik'
    }
  }),
  createOrUpdateDeployment: () => Promise.resolve('1234')
};

const proxyLibs = {
  '../config': {
    mongodb: {
      provision: {
        plan_id: 'd616b00a-5949-4b1c-bc73-0d3c59f3954a',
        network_index: 1
      },
      deployment_name: 'service-fabrik-mongodb-new',
      record_max_fetch_count: 100,
      bosh_job_name: 'broker_mongodb',
      agent: {
        version: '1',
        auth: {
          username: 'agent',
          password: 'secret',
        }
      }
    }
  },
  '../db/DbConnectionManager': {
    startUp: () => Promise.resolve({}),
    getConnectionStatus: () => 1,
    shutDown: () => Promise.resolve({})
  },
  './DirectorManager': {
    load: () => Promise.resolve(DirectorManagerStub)
  },
  '../models/Catalog': {
    getPlan: () => {}
  }
};

const DBManager = proxyquire('../lib/fabrik/DBManager', proxyLibs);

const proxyLib2 = _.cloneDeep(proxyLibs);
proxyLib2['../config'].mongodb.deployment_name = 'service-fabrik-mongodb';
const DBManagerForUpdate = proxyquire('../lib/fabrik/DBManager', proxyLib2);

describe('fabrik', function () {
  /* jshint unused:false */
  /* jshint expr:true */
  describe('DBManager', function () {
    let dbManager;
    let sandbox, getDeploymentVMsStub, startBackupStub, putFileStub, getFileStub, startRestoreStub,
      listBackupFilesStub, getBackupLastOperationStub, getBackupLogsStub, patchBackupFileStub,
      getRestoreLastOperationStub, getRestoreLogsStub, patchRestoreFileStub, getRestoreFileStub,
      listLastRestoreFilesStub, getDeploymentStub, pollTaskStatusTillCompleteStub;
    const db_backup_guid = '925eb8f4-1e14-42f6-b7cd-cdcf05205bb2';
    const dbIps = ['10.11.0.2', '10.11.0.3', '10.11.0.4'];
    const deploymentVms = [{
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'mongodb_z1',
      index: 0,
      id: '9b199ea6-94a3-463d-b3d4-4d4fe89cc364'
    }, {
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'mongodb_z2',
      index: 1,
      id: '9b199ea6-94a3-463d-b3d4-4d4fe89cc364'
    }, {
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'mongodb_z3',
      index: 0,
      id: '9b199ea6-94a3-463d-b3d4-4d4fe89cc364'
    }];
    const expectedVms = [{
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'mongodb_z1',
      index: 0
    }, {
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'mongodb_z2',
      index: 1
    }, {
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'mongodb_z3',
      index: 0
    }];
    const FABRIK_GUIDS = {
      service_id: CONST.FABRIK_INTERNAL_MONGO_DB.SERVICE_ID,
      plan_id: CONST.FABRIK_INTERNAL_MONGO_DB.PLAN_ID,
      space_guid: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID,
      instance_guid: CONST.FABRIK_INTERNAL_MONGO_DB.INSTANCE_ID
    };
    const startDate = new Date().toISOString();
    const finishDate = new Date().toISOString();
    const backupMetaData = _.assign({
      organization_guid: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
      username: 'frodo',
      operation: 'backup',
      type: 'online',
      backup_guid: db_backup_guid,
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
      state: 'succeeded',
      secret: 'OlsK7BSAq2+JnwPF',
      agent_ip: '10.11.0.2',
      started_at: startDate,
      finished_at: finishDate
    }, FABRIK_GUIDS);
    const restoreMetaData = _.assign({
      operation: 'restore',
      backup_guid: db_backup_guid,
      state: 'processing',
      agent_ip: '10.11.0.2',
      started_at: startDate,
      finished_at: finishDate,
      organization_guid: CONST.FABRIK_INTERNAL_MONGO_DB.ORG_ID,
      username: 'frodo'
    }, FABRIK_GUIDS);
    const backup_logs = ['Starting Backup ... ', 'Backup Complete.'];
    const restore_logs = ['Starting Restore ... ', 'Restore Complete.'];
    const backup_state = {
      state: 'succeeded',
      'stage': 'Backup complete',
      updated_at: finishDate
    };
    const restore_state = {
      state: 'succeeded',
      'stage': 'Restore complete',
      updated_at: finishDate
    };
    const deferred = Promise.defer();
    before(function () {
      sandbox = sinon.sandbox.create();
      getDeploymentVMsStub = sandbox.stub(BoshDirectorClient.prototype, 'getDeploymentVms');
      getDeploymentStub = sandbox.stub(BoshDirectorClient.prototype, 'getDeployment');
      pollTaskStatusTillCompleteStub = sandbox.stub(BoshDirectorClient.prototype, 'pollTaskStatusTillComplete');
      startBackupStub = sandbox.stub(Agent.prototype, 'startBackup');
      startRestoreStub = sandbox.stub(Agent.prototype, 'startRestore');
      getBackupLastOperationStub = sandbox.stub(Agent.prototype, 'getBackupLastOperation');
      getBackupLogsStub = sandbox.stub(Agent.prototype, 'getBackupLogs');
      getRestoreLastOperationStub = sandbox.stub(Agent.prototype, 'getRestoreLastOperation');
      getRestoreLogsStub = sandbox.stub(Agent.prototype, 'getRestoreLogs');
      putFileStub = sandbox.stub(BackupStore.prototype, 'putFile');
      getFileStub = sandbox.stub(BackupStore.prototype, 'getBackupFile');
      patchBackupFileStub = sandbox.stub(BackupStore.prototype, 'patchBackupFile');
      patchRestoreFileStub = sandbox.stub(BackupStore.prototype, 'patchRestoreFile');
      listBackupFilesStub = sandbox.stub(BackupStore.prototype, 'listBackupFiles');
      getRestoreFileStub = sandbox.stub(BackupStore.prototype, 'getRestoreFile');
      listLastRestoreFilesStub = sandbox.stub(BackupStore.prototype, 'listLastRestoreFiles');
      getDeploymentVMsStub.withArgs().returns(Promise.resolve(deploymentVms));
      getDeploymentStub.withArgs('service-fabrik-mongodb-new').returns(deferred.promise);
      getDeploymentStub.withArgs('service-fabrik-mongodb').returns(Promise.resolve({}));
      pollTaskStatusTillCompleteStub.withArgs().returns(Promise.resolve({}));
      startBackupStub.withArgs().returns(Promise.resolve('10.11.0.2'));
      startRestoreStub.withArgs().returns(Promise.resolve('10.11.0.2'));
      getBackupLogsStub.withArgs().returns(Promise.resolve(backup_logs));
      getBackupLastOperationStub.withArgs().returns(Promise.resolve(backup_state));
      getRestoreLastOperationStub.withArgs().returns(Promise.resolve(restore_state));
      getRestoreLogsStub.withArgs().returns(Promise.resolve(restore_logs));
      getFileStub.withArgs().returns(Promise.resolve(backupMetaData));
      listBackupFilesStub.withArgs().returns(Promise.resolve([backupMetaData, backupMetaData]));
      putFileStub.withArgs().returns(Promise.resolve({}));
      patchBackupFileStub.withArgs().returns(Promise.resolve({}));
      patchRestoreFileStub.withArgs().returns(Promise.resolve({}));
      getRestoreFileStub.withArgs().returns(Promise.resolve(restoreMetaData));
      listLastRestoreFilesStub.withArgs().returns(Promise.resolve([restoreMetaData, restoreMetaData]));
      dbManager = new DBManager();
    });

    afterEach(function () {
      getDeploymentStub.reset();
      getDeploymentVMsStub.reset();
      pollTaskStatusTillCompleteStub.reset();
      startBackupStub.reset();
      startRestoreStub.reset();
      getBackupLastOperationStub.reset();
      getBackupLogsStub.reset();
      getRestoreLastOperationStub.reset();
      getRestoreLogsStub.reset();
      putFileStub.reset();
      getFileStub.reset();
      patchBackupFileStub.reset();
      patchRestoreFileStub.reset();
      listBackupFilesStub.reset();
      getRestoreFileStub.reset();
      listLastRestoreFilesStub.reset();
    });

    after(function () {
      sandbox.restore();
    });

    it('should initiate provisioning of MongoDB', function () {
      deferred.reject(new errors.NotFound('Deployment not found'));
      return dbManager.createOrUpdateDbDeployment(true).then(taskId => {
        expect(getDeploymentStub).to.be.calledOnce;
        expect(getDeploymentStub.firstCall.args[0]).to.eql('service-fabrik-mongodb-new');
        expect(pollTaskStatusTillCompleteStub).to.be.calledOnce;
        expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql(taskId);
      });
    });

    it('DB update should fail when deployment not found & create flag is false', function () {
      return dbManager.createOrUpdateDbDeployment(false).catch(errors.NotFound, error => {});
    });

    it('DB update should succeed when deployment is found', function () {
      const dbManagerForUpdate = new DBManagerForUpdate();
      return dbManagerForUpdate.createOrUpdateDbDeployment(false).then(taskId => {
        expect(getDeploymentStub).to.be.calledOnce;
        expect(getDeploymentStub.firstCall.args[0]).to.eql('service-fabrik-mongodb');
        expect(pollTaskStatusTillCompleteStub).to.be.calledOnce;
        expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql(taskId);
      });
    });

  });
});