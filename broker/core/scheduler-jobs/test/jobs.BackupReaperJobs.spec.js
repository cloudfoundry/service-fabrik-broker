'use strict';

const _ = require('lodash');
const {
  CONST,
  errors: {
    NotFound
  }
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const moment = require('moment');
const JobFabrik = require('../src/jobs/JobFabrik');
const BaseJob = require('../src/jobs/BaseJob');
const ScheduleManager = require('../src/ScheduleManager');
const { backupStore } = require('@sf/iaas');
const filename = backupStore.filename;

describe('Jobs', function () {
  /* jshint expr:true */

  describe('BackupReaperJob', function () {
    const BackupReaperJob = JobFabrik.getJob(CONST.JOB.BACKUP_REAPER);

    const index = mocks.director.networkSegmentIndex;
    const instance_id = mocks.director.uuidByIndex(index);
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180bc';
    const backup_guidOob = '071acb05-66a3-471b-af3c-8bbf1e4180bd';
    const backup_guid2 = '081acb05-66a3-471b-af3c-8bbf1e4180bf';
    const backup_guid2Oob = '081acb05-66a3-471b-af3c-8bbf1e4180ba';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const container = backupStore.containerName;
    const blueprintContainer = `${backupStore.containerPrefix}-blueprint`;
    const root_folder = CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME;
    const deploymentName = CONST.FABRIK_INTERNAL_MONGO_DB.INSTANCE_ID;
    const started33DaysPrior = filename.isoDate(moment()
      .subtract(config.backup.retention_period_in_days + CONST.BACKUP_REAPER_BUFFER_DURATION_DAYS + 4, 'days').toISOString());
    const started31DaysPrior = filename.isoDate(moment()
      .subtract(config.backup.retention_period_in_days + CONST.BACKUP_REAPER_BUFFER_DURATION_DAYS + 2, 'days').toISOString());
    const prefix = `${space_guid}/backup/${service_id}.${instance_id}`;
    const prefixOob = `${root_folder}/backup/${deploymentName}`;
    const fileName16Daysprior = `${prefix}.${backup_guid}.${started31DaysPrior}.json`;
    const fileName18DaysPrior = `${prefix}.${backup_guid2}.${started33DaysPrior}.json`;
    const pathname16 = `/${container}/${fileName16Daysprior}`;
    const pathname18 = `/${container}/${fileName18DaysPrior}`;
    // For OOB
    const fileName16DayspriorOob = `${prefixOob}.${backup_guidOob}.${started31DaysPrior}.json`;
    const fileName18DaysPriorOob = `${prefixOob}.${backup_guid2Oob}.${started33DaysPrior}.json`;
    const pathname16Oob = `/${container}/${fileName16DayspriorOob}`;
    const pathname18Oob = `/${container}/${fileName18DaysPriorOob}`;

    const archiveFilename1 = `${backup_guid}/volume.tgz.enc`;
    const archivePathname1 = `/${blueprintContainer}/${archiveFilename1}`;
    const repeatInterval = '*/1 * * * *';
    const repeatTimezone = 'America/New_York';
    const time = Date.now();
    const username = 'admin';
    const dummyDeploymentResource = {
      spec: {
        options: JSON.stringify({
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry'
          },
          space_guid: space_guid
        })
      }
    };
    const scheduled_data = {
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid,
      started_at: started31DaysPrior,
      agent_ip: mocks.agent.ip,
      service_id: service_id,
      instance_guid: instance_id
    };
    const scheduled_data_oob = {
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guidOob,
      started_at: started31DaysPrior,
      agent_ip: mocks.agent.ip,
      deployment_name: deploymentName,
      container: blueprintContainer
    };
    const ondemand_data = {
      trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid2,
      started_at: started33DaysPrior,
      agent_ip: mocks.agent.ip,
      service_id: service_id,
      instance_guid: instance_id
    };
    const ondemand_data_oob = {
      trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid2Oob,
      started_at: started33DaysPrior,
      agent_ip: mocks.agent.ip,
      deployment_name: deploymentName,
      container: blueprintContainer
    };
    const job = {
      attrs: {
        name: `${instance_id}_${CONST.JOB.BACKUP_REAPER}`,
        data: {
          delete_delay: 0
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
    const getJob = () => {
      return Promise.resolve({
        name: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`,
        repeatInterval: repeatInterval,
        data: {
          instance_id: instance_id,
          type: 'online'
        },
        nextRunAt: time,
        lastRunAt: time,
        lockedAt: null,
        repeatTimezone: repeatTimezone,
        createdAt: time,
        updatedAt: time,
        createdBy: username,
        updatedBy: username
      });
    };

    let baseJobLogRunHistoryStub, getScheduleStub;

    before(function () {
      mocks.reset();
      baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
      baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
      return mocks.setup();
    });

    beforeEach(function () {
      baseJobLogRunHistoryStub.resetHistory();
    });

    afterEach(function () {
      mocks.reset();
      baseJobLogRunHistoryStub.resetHistory();
    });

    after(function () {
      baseJobLogRunHistoryStub.restore();
    });

    it('should delete scheduled backup older than 14 days', function (done) {
      mocks.cloudProvider.auth(1);
      mocks.cloudProvider.list(container, undefined, [
        fileName16Daysprior
      ]);
      mocks.cloudProvider.list(container, `${space_guid}/backup`, [
        fileName16Daysprior
      ]);
      mocks.cloudProvider.remove(pathname16);
      mocks.cloudProvider.list(blueprintContainer, backup_guid, [archiveFilename1]);
      mocks.cloudProvider.remove(archivePathname1);
      // Out of 3 files 1 day prior is filtered out will not be deleted
      mocks.cloudProvider.download(pathname16, scheduled_data);

      // For Oob
      mocks.cloudProvider.list(container, `${root_folder}/backup`, [
        fileName16DayspriorOob
      ], undefined, 2);
      mocks.cloudProvider.remove(pathname16Oob);
      mocks.cloudProvider.list(blueprintContainer, backup_guidOob, [archiveFilename1]);
      mocks.cloudProvider.remove(archivePathname1);
      // Out of 3 files 1 day prior is filtered out will not be deleted
      mocks.cloudProvider.list(container, `${prefixOob}.${backup_guidOob}`, [
        fileName16DayspriorOob
      ]);
      mocks.cloudProvider.download(pathname16Oob, scheduled_data_oob, 2);
      // Mocks done
      getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule').callsFake(getJob);
      return BackupReaperJob.run(job, () => {
        let ignoreNock = ["POST https://myopenstackcloud.com:5000/v3/auth/tokens"];
        mocks.verify(ignoreNock);
        const expectedBackupResponse = {
          deleted_guids: [backup_guid, backup_guidOob]
        };
        expect(getScheduleStub).to.be.callCount(0);
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        getScheduleStub.restore();
        done();
      });
    });

    it('should not delete on-demand backup', function (done) {
      mocks.cloudProvider.list(container, undefined, [
        fileName18DaysPrior
      ]);
      mocks.cloudProvider.list(container, `${space_guid}/backup`, [
        fileName18DaysPrior
      ]);
      mocks.cloudProvider.download(pathname18, ondemand_data);
      // For OOB
      mocks.cloudProvider.list(container, `${root_folder}/backup`, [
        fileName18DaysPriorOob
      ], undefined, 2);
      mocks.cloudProvider.download(pathname18Oob, ondemand_data_oob, 2);
      mocks.cloudProvider.list(container, `${prefixOob}.${backup_guid2Oob}`, [
        fileName18DaysPriorOob
      ]);
      getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule').callsFake(getJob);
      return BackupReaperJob.run(job, () => {
        mocks.verify();
        const expectedBackupResponse = {
          deleted_guids: [undefined, undefined]
        };
        expect(getScheduleStub).to.be.callCount(2);
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        getScheduleStub.restore();
        done();
      });
    });

    it('should not delete on-demand backup when schedule job not found and deployment or service instance present', function (done) {
      mocks.cloudProvider.list(container, undefined, [
        fileName18DaysPrior
      ]);
      mocks.cloudProvider.list(container, `${space_guid}/backup`, [
        fileName18DaysPrior
      ]);
      mocks.cloudProvider.download(pathname18, ondemand_data);
      // For OOB
      mocks.cloudProvider.list(container, `${root_folder}/backup`, [
        fileName18DaysPriorOob
      ], undefined, 2);
      mocks.cloudProvider.download(pathname18Oob, ondemand_data_oob, 2);
      mocks.cloudProvider.list(container, `${prefixOob}.${backup_guid2Oob}`, [
        fileName18DaysPriorOob
      ]);
      getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule').callsFake(() => {
        return Promise.try(() => {
          throw new NotFound('Schedulde not found.');
        });
      });
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
      mocks.director.getDeployment(deploymentName, true);
      return BackupReaperJob.run(job, () => {
        mocks.verify();
        const expectedBackupResponse = {
          deleted_guids: [undefined, undefined]
        };
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        expect(getScheduleStub).to.be.callCount(2);
        expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        getScheduleStub.restore();
        done();
      });
    });

    it('should delete 14 days older on-demand backup when schedule job not found and deployment or service instance deleted', function (done) {
      mocks.cloudProvider.list(container, undefined, [
        fileName18DaysPrior
      ]);
      mocks.cloudProvider.list(container, `${space_guid}/backup`, [
        fileName18DaysPrior
      ]);
      mocks.cloudProvider.download(pathname18, ondemand_data);
      mocks.cloudProvider.list(blueprintContainer, `${backup_guid2}`, [
        `${backup_guid2}/volume.tgz.enc`
      ]);
      mocks.cloudProvider.remove(`/${blueprintContainer}/${backup_guid2}/volume.tgz.enc`);
      mocks.cloudProvider.remove(pathname18);
      // For OOB
      mocks.cloudProvider.list(container, `${root_folder}/backup`, [
        fileName18DaysPriorOob
      ], undefined, 2);
      mocks.cloudProvider.download(pathname18Oob, ondemand_data_oob, 2);
      mocks.cloudProvider.list(container, `${prefixOob}.${backup_guid2Oob}`, [
        fileName18DaysPriorOob
      ]);
      mocks.cloudProvider.list(blueprintContainer, `${backup_guid2Oob}`, [
        `${backup_guid2Oob}/volume.tgz.enc`
      ]);
      mocks.cloudProvider.remove(`/${blueprintContainer}/${backup_guid2Oob}/volume.tgz.enc`);
      mocks.cloudProvider.remove(pathname18Oob);
      getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule').callsFake(() => {
        return Promise.try(() => {
          throw new NotFound('Schedulde not found.');
        });
      });
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, 404);
      mocks.director.getDeployment(deploymentName, false, undefined, 2);
      return BackupReaperJob.run(job, () => {
        mocks.verify();
        const expectedBackupResponse = {
          deleted_guids: [backup_guid2, backup_guid2Oob]
        };
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        expect(getScheduleStub).to.be.callCount(2);
        expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        getScheduleStub.restore();
        done();
      });
    });

    it('should not delete scheduled older oob backup not having container in metadata', function (done) {
      mocks.cloudProvider.list(container, undefined, [
        fileName16Daysprior
      ]);
      mocks.cloudProvider.list(container, `${space_guid}/backup`, [
        fileName16Daysprior
      ]);
      mocks.cloudProvider.remove(pathname16);
      mocks.cloudProvider.list(blueprintContainer, backup_guid, [archiveFilename1]);
      mocks.cloudProvider.remove(archivePathname1);
      // Out of 3 files 1 day prior is filtered out will not be deleted
      mocks.cloudProvider.download(pathname16, scheduled_data);

      // For Oob
      mocks.cloudProvider.list(container, `${root_folder}/backup`, [
        fileName16DayspriorOob
      ], undefined, 1);
      mocks.cloudProvider.list(container, `${prefixOob}.${backup_guidOob}`, [
        fileName16DayspriorOob
      ]);
      mocks.cloudProvider.download(pathname16Oob, _.chain(scheduled_data_oob).omit('container').value());
      // Mocks done
      getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule').callsFake(getJob);
      return BackupReaperJob.run(job, () => {
        mocks.verify();
        const expectedBackupResponse = {
          deleted_guids: [backup_guid, undefined]
        };
        expect(getScheduleStub).to.be.callCount(0);
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        getScheduleStub.restore();
        done();
      });
    });

    it('should log delete backup as failed', function (done) {
      mocks.cloudProvider.list(container, undefined, [], 404);
      return BackupReaperJob.run(job, () => {
        mocks.verify();
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        const expectedJobResponse = {};
        expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Error');
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedJobResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        done();
      });
    });

  });
});
