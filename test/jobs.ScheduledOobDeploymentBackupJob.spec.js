'use strict';

const moment = require('moment');
const _ = require('lodash');
const CONST = require('../broker/lib/constants');
const config = require('../broker/lib/config');
const lib = require('../broker/lib');
const utils = require('../broker/lib/utils');
const BaseJob = require('../broker/lib/jobs/BaseJob');
const ScheduleManager = require('../broker/lib/jobs/ScheduleManager');
const backupStore = lib.iaas.backupStoreForOob;
const filename = lib.iaas.backupStoreForOob.filename;
const ScheduledOobDeploymentBackupJob = require('../broker/lib/jobs/ScheduledOobDeploymentBackupJob');

describe('Jobs', function () {
  /* jshint expr:true */
  describe('ScheduledOobDeploymentBackupJob', function () {
    const container = backupStore.containerName;
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const root_folder = CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME;
    const deploymentName = CONST.FABRIK_INTERNAL_MONGO_DB.INSTANCE_ID;
    const started14DaysPrior = filename.isoDate(moment()
      .subtract(config.backup.retention_period_in_days + 1, 'days').toISOString());
    const prefix = `${root_folder}/backup/${deploymentName}`;
    // const prefixForDelete = `${space_guid}/backup/${instance_id}.${backup_guid}`;
    const fileName14Daysprior = `${prefix}.${backup_guid}.${started14DaysPrior}.json`;
    const pathname14 = `/${container}/${fileName14Daysprior}`;
    const mongoDBContainer = config.backup.provider.container;
    // const mongoDBContainer = _.replace(config.mongodb.agent.provider.container,'broker-db','postgresql');
    const backupFileName14DayspriorToDelete = `/${backup_guid}`;
    const scheduled_data = {
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid,
      started_at: started14DaysPrior,
      agent_ip: mocks.agent.ip
    };
    const job = {
      attrs: {
        name: `${deploymentName}_${CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP}`,
        data: {
          deployment_name: deploymentName,
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
          container: mongoDBContainer,
          delete_delay: 1
        },
        lastRunAt: new Date(),
        nextRunAt: new Date(),
        repeatInterval: '*/1 * * * *',
        lockedAt: null,
        repeatTimezone: 'America/New_York'
      },
      fail: () => undefined,
      save: () => undefined,
      touch: () => undefined
    };
    let baseJobLogRunHistoryStub, cancelScheduleStub;

    before(function () {
      mocks.reset();
      backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
      mocks.cloudProvider.auth();
      mocks.cloudProvider.getContainer(container);
      baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
      baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
      cancelScheduleStub = sinon.stub(ScheduleManager, 'cancelSchedule', () => Promise.resolve({}));
      return mocks.setup([backupStore.cloudProvider.getContainer()]);
    });

    afterEach(function () {
      mocks.reset();
      cancelScheduleStub.reset();
      baseJobLogRunHistoryStub.reset();
    });

    after(function () {
      cancelScheduleStub.restore();
      baseJobLogRunHistoryStub.restore();
    });

    describe('#RunBackup', function () {
      it('should initiate deployment backup, delete scheduled backup older than 14 days & backup operation status is succesful', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'backup'
        });
        const backupResponse = {
          backup_guid: backup_guid
        };

        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.serviceBrokerClient.startDeploymentBackup(deploymentName, backupResponse);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.list(container, `${root_folder}/backup`, [fileName14Daysprior]);
        mocks.cloudProvider.list(mongoDBContainer, backup_guid, [
          backupFileName14DayspriorToDelete
        ]);
        mocks.cloudProvider.remove(`/${mongoDBContainer}${backupFileName14DayspriorToDelete}`);
        mocks.cloudProvider.remove(pathname14);
        mocks.director.getDeployment(deploymentName, true);
        try {
          const old_frequency = config.backup.backup_restore_status_check_every;
          config.backup.backup_restore_status_check_every = 200;
          return ScheduledOobDeploymentBackupJob.run(job, () => {})
            .then(() => {
              mocks.verify();
              const expectedBackupResponse = {
                start_backup_status: {
                  operation: 'backup',
                  backup_guid: backupResponse.backup_guid,
                  token: token
                },
                delete_backup_status: {
                  deleted_guids: ['071acb05-66a3-471b-af3c-8bbf1e4180be'],
                  job_cancelled: false,
                  deployment_deleted: false
                }
              };
              config.backup.backup_restore_status_check_every = old_frequency;
              expect(baseJobLogRunHistoryStub).to.be.calledOnce;
              expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
              expect(_.omit(baseJobLogRunHistoryStub.firstCall.args[1], 'status', 'deleted_guids')).to.eql(expectedBackupResponse);
              expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
              expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
            });
        } catch (ex) {
          console.log('exception occurred', ex);
          mocks.verify();
        }
      });

      it('should log start backup as failed', function (done) {
        mocks.serviceBrokerClient.startDeploymentBackup(deploymentName, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
          status: 500,
          backup_guid: backup_guid
        });
        mocks.director.getDeployment(deploymentName, true);
        return ScheduledOobDeploymentBackupJob.run(job, () => {
          mocks.verify();
          const errStatusCode = 500;
          const backupRunStatus = {
            start_backup_status: 'failed',
            delete_backup_status: 'failed'
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('InternalServerError');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(errStatusCode);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(backupRunStatus);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        });
      });

      it('should log delete backup as failed', function (done) {
        mocks.director.getDeployment(deploymentName, true);
        mocks.serviceBrokerClient.startDeploymentBackup(deploymentName, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
          backup_guid: backup_guid
        });
        mocks.cloudProvider.list(container, prefix, [], 404);
        return ScheduledOobDeploymentBackupJob.run(job, () => {
          mocks.verify();
          const failCode = 'Item not found';
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          const expectedJobResponse = {
            start_backup_status: {
              operation: 'backup',
              backup_guid: backup_guid,
              token: utils.encodeBase64({
                backup_guid: backup_guid,
                agent_ip: mocks.agent.ip,
                operation: 'backup'
              })
            },
            delete_backup_status: 'failed'
          };
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Error');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].failCode).to.eql(failCode);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        });
      });

      it('should delete scheduled backup even when deployment is deleted', function (done) {
        mocks.director.getDeployment(deploymentName, false, undefined, 2);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.list(container, `${root_folder}/backup`, [fileName14Daysprior]);
        mocks.cloudProvider.list(mongoDBContainer, backup_guid, [
          backupFileName14DayspriorToDelete
        ]);
        mocks.cloudProvider.remove(`/${mongoDBContainer}${backupFileName14DayspriorToDelete}`);
        mocks.cloudProvider.remove(pathname14);
        return ScheduledOobDeploymentBackupJob.run(job, () => {
          const expectedJobResponse = {
            start_backup_status: 'deployment_deleted',
            delete_backup_status: {
              deleted_guids: [backup_guid],
              job_cancelled: false,
              deployment_deleted: true
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          mocks.verify();
          done();
        });
      });

      it('should cancel backup job (itself) when there are no more backups to delete & deployment is deleted', function (done) {
        mocks.director.getDeployment(deploymentName, false, undefined, 2);
        mocks.cloudProvider.list(container, prefix, []);
        mocks.cloudProvider.list(container, prefix, []);
        return ScheduledOobDeploymentBackupJob.run(job, () => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'deployment_deleted',
            delete_backup_status: {
              deleted_guids: [],
              job_cancelled: true,
              deployment_deleted: true
            }
          };
          expect(cancelScheduleStub).to.be.calledOnce;
          expect(cancelScheduleStub.firstCall.args[0]).to.eql(deploymentName);
          expect(cancelScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP);
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.eql(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        });
      });

      it('should initiate deployment backup, delete scheduled backup older than 14 days & backup operation status is succesful (for bosh-sf deployments)', function (done) {

        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'backup'
        });
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.serviceBrokerClient.startDeploymentBackup(deploymentName, backupResponse, {
          bosh_director: CONST.BOSH_DIRECTORS.BOSH_SF
        });
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.list(container, `${root_folder}/backup`, [fileName14Daysprior]);
        mocks.cloudProvider.list(mongoDBContainer, backup_guid, [
          backupFileName14DayspriorToDelete
        ]);
        mocks.cloudProvider.remove(`/${mongoDBContainer}${backupFileName14DayspriorToDelete}`);
        mocks.cloudProvider.remove(pathname14);
        mocks.director.getDeployment(deploymentName, true);
        try {
          const old_frequency = config.backup.backup_restore_status_check_every;
          config.backup.backup_restore_status_check_every = 200;
          let boshSfBackupJob = job;
          boshSfBackupJob.attrs.data.bosh_director = CONST.BOSH_DIRECTORS.BOSH_SF;
          return ScheduledOobDeploymentBackupJob.run(boshSfBackupJob, () => {
            mocks.verify();
            const expectedBackupResponse = {
              start_backup_status: {
                operation: 'backup',
                backup_guid: backupResponse.backup_guid,
                token: token
              },
              delete_backup_status: {
                deleted_guids: ['071acb05-66a3-471b-af3c-8bbf1e4180be'],
                job_cancelled: false,
                deployment_deleted: false
              }
            };
            config.backup.backup_restore_status_check_every = old_frequency;
            expect(baseJobLogRunHistoryStub).to.be.calledOnce;
            expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
            expect(_.omit(baseJobLogRunHistoryStub.firstCall.args[1], 'status', 'deleted_guids')).to.eql(expectedBackupResponse);
            expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
            expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
            done();
          });
        } catch (ex) {
          console.log('exception occurred');
          mocks.verify();
        }
      });

      it('should delete scheduled backup even when deployment is deleted (bosh-sf deployments)', function (done) {
        mocks.director.getDeployment(deploymentName, false, undefined, 2);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.list(container, `${root_folder}/backup`, [fileName14Daysprior]);
        mocks.cloudProvider.list(mongoDBContainer, backup_guid, [
          backupFileName14DayspriorToDelete
        ]);
        mocks.cloudProvider.remove(`/${mongoDBContainer}${backupFileName14DayspriorToDelete}`);
        mocks.cloudProvider.remove(pathname14);
        let boshSfBackupJob = job;
        boshSfBackupJob.attrs.data.bosh_director = CONST.BOSH_DIRECTORS.BOSH_SF;
        return ScheduledOobDeploymentBackupJob.run(boshSfBackupJob, () => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'deployment_deleted',
            delete_backup_status: {
              deleted_guids: [backup_guid],
              job_cancelled: false,
              deployment_deleted: true
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        });
      });

      it('should delete scheduled backup even when backup data not found', function (done) {
        mocks.director.getDeployment(deploymentName, false, undefined, 2);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.list(container, `${root_folder}/backup`, [fileName14Daysprior]);
        mocks.cloudProvider.list(mongoDBContainer, backup_guid, [
          backupFileName14DayspriorToDelete
        ], 404);
        mocks.cloudProvider.remove(pathname14);
        let boshSfBackupJob = job;
        boshSfBackupJob.attrs.data.bosh_director = CONST.BOSH_DIRECTORS.BOSH_SF;
        return ScheduledOobDeploymentBackupJob.run(boshSfBackupJob, () => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'deployment_deleted',
            delete_backup_status: {
              deleted_guids: [backup_guid],
              job_cancelled: false,
              deployment_deleted: true
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        });
      });

      it('should log error in case deployment name and type are absent in Job data', function (done) {
        let sfClientStub;
        sfClientStub = sinon.stub(ScheduledOobDeploymentBackupJob, 'getFabrikClient');
        job.attrs.data = {};
        ScheduledOobDeploymentBackupJob.run(job, () => {
          const invalidInputMsg = `Scheduled deployment backup cannot be initiated as the required mandatory params 
      (deployment_name | type) is empty : ${JSON.stringify(job.attrs.data)}`;
          expect(sfClientStub).not.to.be.called;
          sfClientStub.restore();
          expect(baseJobLogRunHistoryStub.firstCall.args[0].message).to.eql(invalidInputMsg);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('BadRequest');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].reason).to.eql('Bad Request');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(400);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql({});
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        });
      });

    });
  });
});