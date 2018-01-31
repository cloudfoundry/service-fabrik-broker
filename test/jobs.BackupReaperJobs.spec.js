'use strict';

const CONST = require('../lib/constants');
const config = require('../lib/config');
const moment = require('moment');
const lib = require('../lib');
const JobFabrik = require('../lib/jobs/JobFabrik');
const BaseJob = require('../lib/jobs/BaseJob');
const ScheduleManager = require('../lib/jobs/ScheduleManager');
const backupStore = lib.iaas.backupStore;
const filename = lib.iaas.backupStore.filename;

describe('Jobs', function () {
  /* jshint expr:true */

  describe('BackupReaperJob', function () {
    const BackupReaperJob = JobFabrik.getJob(CONST.JOB.BACKUP_REAPER);

    const index = mocks.director.networkSegmentIndex;
    const instance_id = mocks.director.uuidByIndex(index);
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const backup_guid2 = '081acb05-66a3-471b-af3c-8bbf1e4180bf';
    //const backup_guid3 = '091acb05-66a3-471b-af3c-8bbf1e4180bg';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const container = backupStore.containerName;
    const blueprintContainer = `${backupStore.containerPrefix}-blueprint`;
    //const started1DaysPrior = filename.isoDate(moment().subtract(1, 'days').toISOString());
    const started18DaysPrior = filename.isoDate(moment()
      .subtract(config.backup.retention_period_in_days + 4, 'days').toISOString());
    const started16DaysPrior = filename.isoDate(moment()
      .subtract(config.backup.retention_period_in_days + 2, 'days').toISOString());
    const prefix = `${space_guid}/backup/${service_id}.${instance_id}`;
    //const fileName1Daysprior = `${prefix}.${backup_guid3}.${started1DaysPrior}.json`;
    const fileName16Daysprior = `${prefix}.${backup_guid}.${started16DaysPrior}.json`;
    const fileName18DaysPrior = `${prefix}.${backup_guid2}.${started18DaysPrior}.json`;
    const pathname16 = `/${container}/${fileName16Daysprior}`;
    const pathname18 = `/${container}/${fileName18DaysPrior}`;
    const archiveFilename1 = `${backup_guid}/volume.tgz.enc`;
    const archivePathname1 = `/${blueprintContainer}/${archiveFilename1}`;
    // const archiveFilename2 = `${backup_guid2}/volume.tgz.enc`;
    // const archivePathname2 = `/${blueprintContainer}/${archiveFilename2}`;
    const repeatInterval = '*/1 * * * *';
    const repeatTimezone = 'America/New_York';
    const time = Date.now();
    const username = 'admin';
    const scheduled_data = {
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid,
      started_at: started16DaysPrior,
      agent_ip: mocks.agent.ip,
      service_id: service_id,
      instance_guid: instance_id
    };
    const ondemand_data = {
      trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid2,
      started_at: started18DaysPrior,
      agent_ip: mocks.agent.ip,
      service_id: service_id,
      instance_guid: instance_id
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
      backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
      mocks.reset();
      mocks.cloudProvider.auth();
      mocks.cloudProvider.getContainer(container);
      baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
      getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule', getJob);
      baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
      return mocks.setup([backupStore.cloudProvider.getContainer()]);
    });

    beforeEach(function () {
      mocks.reset();
      baseJobLogRunHistoryStub.reset();
      getScheduleStub.reset();
    });

    afterEach(function () {
      mocks.reset();
      baseJobLogRunHistoryStub.reset();
      getScheduleStub.reset();
    });

    after(function () {
      baseJobLogRunHistoryStub.restore();
      getScheduleStub.restore();
    });

    it('should delete scheduled backup older than 14 days', function (done) {
      mocks.cloudProvider.list(container, undefined, [
        fileName16Daysprior
      ]);
      mocks.cloudProvider.list(container, `${space_guid}/backup`, [
        fileName16Daysprior
      ]);
      mocks.cloudProvider.remove(pathname16);
      mocks.cloudProvider.list(blueprintContainer, backup_guid, [archiveFilename1]);
      mocks.cloudProvider.remove(archivePathname1);
      //Out of 3 files 1 day prior is filtered out will not be deleted
      mocks.cloudProvider.download(pathname16, scheduled_data);
      return BackupReaperJob.run(job, () => {
        mocks.verify();
        const expectedBackupResponse = {
          deleted_guids: [backup_guid]
        };
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
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
      // mocks.cloudProvider.remove(pathname18);
      // mocks.cloudProvider.list(blueprintContainer, backup_guid2, [archiveFilename2]);
      // mocks.cloudProvider.remove(archivePathname2);
      //Out of 3 files 1 day prior is filtered out will not be deleted
      mocks.cloudProvider.download(pathname18, ondemand_data);
      return BackupReaperJob.run(job, () => {
        mocks.verify();
        const expectedBackupResponse = {
          deleted_guids: [undefined]
        };
        expect(baseJobLogRunHistoryStub).to.be.calledOnce;
        expect(getScheduleStub).to.be.calledOnce;
        expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
        expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
        expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
        expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        done();
      });
    });

    it('should log delete backup as failed', function (done) {
      //mocks.cloudController.findServicePlan(instance_id, plan_id);
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