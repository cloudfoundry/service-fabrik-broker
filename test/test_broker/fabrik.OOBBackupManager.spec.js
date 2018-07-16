'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const BoshDirectorClient = require('../../data-access-layer/bosh/BoshDirectorClient');
const BackupStore = require('../../data-access-layer/iaas/BackupStore');
const Agent = require('../../broker/lib/fabrik/Agent');
const FabrikBaseController = require('../../api-controllers/FabrikBaseController');
const CONST = require('../../broker/lib/constants');
const OobBackupManager = require('../../broker/lib/fabrik/OobBackupManager');
const bosh = require('../../data-access-layer/bosh');
const backupStoreForOob = require('../../data-access-layer/iaas').backupStoreForOob;


describe('fabrik', function () {
  /* jshint expr:true */
  describe('OobBackupManager', function () {
    let oobBackupManager;
    let sandbox, getDeploymentVMsStub, getHostStub, startBackupStub, putFileStub, getFileStub, startRestoreStub,
      listOobBackupFilesStub, getBackupLastOperationStub, getBackupLogsStub, patchBackupFileStub,
      getRestoreLastOperationStub, getRestoreLogsStub, patchRestoreFileStub, getRestoreFileStub,
      getDeploymentManifestStub, getDeploymentInstancesStub;
    const db_backup_guid = '925eb8f4-1e14-42f6-b7cd-cdcf05205bb2';
    const dbIps = ['10.11.0.2', '10.11.0.3'];
    const deploymentName = 'ccdb';
    const deploymentVms = [{
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'postgresql_master_z1',
      index: 0,
      ips: ['10.11.0.2'],
      iaas_vm_metadata: {
        'vm_id': '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5'
      },
      id: '9b199ea6-94a3-463d-b3d4-4d4fe89cc364'
    }, {
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'postgresql_slave_z1',
      index: 0,
      ips: ['10.11.0.3'],
      iaas_vm_metadata: {
        'vm_id': '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5'
      },
      id: '9b199ea6-94a3-463d-b3d4-4d4fe89cc364'
    }];
    const expectedVms = [{
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'postgresql_master_z1',
      index: 0,
      iaas_vm_metadata: {
        'vm_id': '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5'
      }
    }, {
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'postgresql_slave_z1',
      index: 0,
      iaas_vm_metadata: {
        'vm_id': '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5'
      }
    }];
    const FABRIK_GUIDS = {
      root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
    };
    const startDate = new Date().toISOString();
    const finishDate = new Date().toISOString();
    const backupMetaData = _.assign({
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

    const manifest = {
      instance_groups: [{
        name: 'postgresql',
        instances: 1,
        networks: [{
          name: 'default',
          static_ips: ['10.11.0.2', '10.11.0.3']
        }],
        jobs: [{
          name: 'broker-agent',
          properties: {
            provider: 'openstack',
            username: 'admin',
            password: 'admin'
          }
        }]
      }]
    };

    before(function () {
      sandbox = sinon.sandbox.create();
      getDeploymentVMsStub = sandbox.stub(BoshDirectorClient.prototype, 'getDeploymentVms');
      getDeploymentInstancesStub = sandbox.stub(BoshDirectorClient.prototype, 'getDeploymentInstances');
      getDeploymentManifestStub = sandbox.stub(BoshDirectorClient.prototype, 'getDeploymentManifest');
      getHostStub = sandbox.stub(Agent.prototype, 'getHost');
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
      listOobBackupFilesStub = sandbox.stub(BackupStore.prototype, 'listBackupFiles');
      getRestoreFileStub = sandbox.stub(BackupStore.prototype, 'getRestoreFile');
      getDeploymentVMsStub.withArgs(deploymentName).returns(Promise.resolve(deploymentVms));
      getDeploymentInstancesStub.withArgs(deploymentName).returns(Promise.resolve(deploymentVms));
      getDeploymentManifestStub.withArgs(deploymentName).returns(new Promise.resolve(manifest));
      getHostStub.withArgs().returns(Promise.resolve('10.11.0.2'));
      startBackupStub.withArgs().returns(Promise.resolve('10.11.0.2'));
      startRestoreStub.withArgs().returns(Promise.resolve('10.11.0.2'));
      getBackupLogsStub.withArgs().returns(Promise.resolve(backup_logs));
      getBackupLastOperationStub.withArgs().returns(Promise.resolve(backup_state));
      getRestoreLastOperationStub.withArgs().returns(Promise.resolve(restore_state));
      getRestoreLogsStub.withArgs().returns(Promise.resolve(restore_logs));
      getFileStub.withArgs().returns(Promise.resolve(backupMetaData));
      listOobBackupFilesStub.withArgs().returns(Promise.resolve([backupMetaData, backupMetaData]));
      putFileStub.withArgs().returns(Promise.resolve({}));
      patchBackupFileStub.withArgs().returns(Promise.resolve({}));
      patchRestoreFileStub.withArgs().returns(Promise.resolve({}));
      getRestoreFileStub.withArgs().returns(Promise.resolve(restoreMetaData));
      oobBackupManager = new OobBackupManager();
    });

    afterEach(function () {
      getDeploymentManifestStub.reset();
      getDeploymentInstancesStub.reset();
      getDeploymentVMsStub.reset();
      getHostStub.reset();
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
      listOobBackupFilesStub.reset();
      getRestoreFileStub.reset();
    });

    after(function () {
      sandbox.restore();
    });

    it('should retrieve DB VM Details from bosh successfully', function () {
      return bosh.director.getNormalizedDeploymentVms(deploymentName).then(dbVms => {
        expect(getDeploymentVMsStub).to.be.calledOnce;
        expect(getDeploymentVMsStub.firstCall.args[0]).to.eql(deploymentName);
        expect(dbVms).to.have.length(2);
        expect(dbVms).to.eql(expectedVms);
      });
    });

    it('should initiate backup of CCDB deployment successfully', function () {
      const opts = {
        deploymentName: deploymentName,
        user: {
          name: 'frodo'
        },
        arguments: {
          container: `${backupStoreForOob.containerPrefix}-postgresql`
        }
      };
      const expectedResult = {
        operation: 'backup',
        backup_guid: undefined,
        agent_ip: '10.11.0.2'
      };
      return oobBackupManager.startBackup(opts).then(result => {
        expect(startBackupStub).to.be.calledOnce;
        expect(putFileStub).to.be.calledOnce;
        expect(getHostStub).to.be.calledOnce;
        expect(getHostStub.firstCall.args[0]).to.eql(dbIps);
        expect(startBackupStub.firstCall.args[0]).to.eql(expectedResult.agent_ip);
        expect(startBackupStub.firstCall.args[1].trigger).to.eql(CONST.BACKUP.TRIGGER.ON_DEMAND);
        expect(startBackupStub.firstCall.args[1].type).to.eql('online');
        expect(startBackupStub.firstCall.args[2]).to.eql(expectedVms);
        expect(result.operation).to.eql(expectedResult.operation);

        expect(result.agent_ip).to.eql(expectedResult.agent_ip);
        expect(FabrikBaseController.uuidPattern.test(result.backup_guid)).to.eql(true);
      });
    });

    it('should initiate backup of CCDB deployment successfully - without container', function () {
      const opts = {
        deploymentName: deploymentName,
        user: {
          name: 'frodo'
        }
      };
      const expectedResult = {
        operation: 'backup',
        backup_guid: undefined,
        agent_ip: '10.11.0.2'
      };
      return oobBackupManager.startBackup(opts).then(result => {
        expect(startBackupStub).to.be.calledOnce;
        expect(putFileStub).to.be.calledOnce;
        expect(getHostStub).to.be.calledOnce;
        expect(getHostStub.firstCall.args[0]).to.eql(dbIps);
        expect(startBackupStub.firstCall.args[0]).to.eql(expectedResult.agent_ip);
        expect(startBackupStub.firstCall.args[1].trigger).to.eql(CONST.BACKUP.TRIGGER.ON_DEMAND);
        expect(startBackupStub.firstCall.args[1].type).to.eql('online');
        expect(startBackupStub.firstCall.args[2]).to.eql(expectedVms);
        expect(result.operation).to.eql(expectedResult.operation);

        expect(result.agent_ip).to.eql(expectedResult.agent_ip);
        expect(FabrikBaseController.uuidPattern.test(result.backup_guid)).to.eql(true);
      });
    });

    it('should return status of the last backup operation successfully', function () {
      const options = {
        deploymentName: deploymentName,
        agent_ip: '10.11.0.2'
      };
      return oobBackupManager.getLastBackupStatus(options).then(result => {
        expect(result).to.eql(backup_state);
        expect(getBackupLastOperationStub).to.be.calledOnce;
        expect(getBackupLastOperationStub.firstCall.args[0]).to.eql(options.agent_ip);
        expect(getBackupLogsStub).to.be.calledOnce;
        expect(getBackupLogsStub.firstCall.args[0]).to.eql(options.agent_ip);
        expect(patchBackupFileStub).to.be.calledOnce;
      });
    });

    it('should return the backup for the input backup guid and CCDB deployment successfully', function () {
      const expectedResult = [backupMetaData];
      return oobBackupManager.getBackup(deploymentName, db_backup_guid).then(result => {
        expect(getFileStub).to.be.calledOnce;
        expect(getFileStub.firstCall.args[0]).to.eql(_.assign({
          deployment_name: deploymentName,
          backup_guid: db_backup_guid
        }, FABRIK_GUIDS));
        expect(result).to.eql(expectedResult);
      });
    });

    it('should return all the backups for CCDB deploymentsuccessfully', function () {
      const expectedResult = [backupMetaData, backupMetaData];
      return oobBackupManager.getBackup(deploymentName).then(result => {
        expect(listOobBackupFilesStub).to.be.calledOnce;
        expect(listOobBackupFilesStub.firstCall.args[0]).to.eql(_.assign({
          deployment_name: deploymentName,
          backup_guid: undefined
        }, FABRIK_GUIDS));
        expect(result).to.eql(expectedResult);
      });
    });

    it('should initiate restore of CCDB deployment successfully', function () {
      const opts = {
        deploymentName: deploymentName,
        backup_guid: db_backup_guid,
        user: {
          name: 'frodo'
        }
      };
      const expectedResult = {
        operation: 'restore',
        backup_guid: db_backup_guid,
        agent_ip: '10.11.0.2'
      };
      return oobBackupManager.startRestore(opts).then(result => {
        expect(startRestoreStub).to.be.calledOnce;
        expect(putFileStub).to.be.calledOnce;
        expect(startRestoreStub.firstCall.args[0]).to.eql(dbIps);
        expect(result).to.eql(expectedResult);
      });
    });

    it('should return status of the last restore operation successfully', function () {
      const options = {
        deploymentName: deploymentName,
        agent_ip: '10.11.0.2'
      };
      return oobBackupManager.getLastRestoreStatus(options).then(result => {
        expect(result).to.eql(restore_state);
        expect(getRestoreLastOperationStub).to.be.calledOnce;
        expect(getRestoreLastOperationStub.firstCall.args[0]).to.eql(options.agent_ip);
        expect(getRestoreLogsStub).to.be.calledOnce;
        expect(getRestoreLogsStub.firstCall.args[0]).to.eql(options.agent_ip);
        expect(patchRestoreFileStub).to.be.calledOnce;
      });
    });

    it('should return the restore info for the input backup guid successfully', function () {
      const clonedMeta = _.clone(restoreMetaData);
      clonedMeta.state = 'succeeded';
      clonedMeta.stage = 'Restore complete';
      const expectedResult = clonedMeta;
      return oobBackupManager.getRestore(deploymentName).then(result => {
        expect(getRestoreFileStub).to.be.calledOnce;
        expect(getRestoreFileStub.firstCall.args[0]).to.eql(_.assign({
          deployment_name: deploymentName,
          backup_guid: undefined
        }, FABRIK_GUIDS));
        expect(result).to.eql(expectedResult);
      });
    });

  });
});