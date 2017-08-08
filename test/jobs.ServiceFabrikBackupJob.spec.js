'use strict';

const moment = require('moment');
const _ = require('lodash');
const CONST = require('../lib/constants');
const config = require('../lib/config');
const lib = require('../lib');
const utils = require('../lib/utils');
const BaseJob = require('../lib/jobs/BaseJob');
const backupStore = lib.iaas.backupStore;
const filename = lib.iaas.backupStore.filename;
const ServiceFabrikBackupJob = require('../lib/jobs/ServiceFabrikBackupJob');

describe('Jobs', function () {
  /* jshint expr:true */
  describe('ServiceFabrikBackupJob', function () {
    const container = backupStore.containerName;
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const space_guid = CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID;
    const service_id = CONST.FABRIK_INTERNAL_MONGO_DB.SERVICE_ID;
    const plan_id = CONST.FABRIK_INTERNAL_MONGO_DB.PLAN_ID;
    const instance_id = CONST.FABRIK_INTERNAL_MONGO_DB.INSTANCE_ID;
    const started14DaysPrior = filename.isoDate(moment()
      .subtract(config.backup.retention_period_in_days + 1, 'days').toISOString());
    const prefix = `${space_guid}/backup/${service_id}.${plan_id}.${instance_id}`;
    const prefixForDelete = `${space_guid}/backup/${service_id}.${plan_id}.${instance_id}.${backup_guid}`;
    const fileName14Daysprior = `${prefix}.${backup_guid}.${started14DaysPrior}.json`;
    const pathname14 = `/${container}/${fileName14Daysprior}`;
    const mongoDBContainer = config.mongodb.agent.provider.container;
    const backupFileName14DayspriorToDelete = `/${backup_guid}`;
    const scheduled_data = {
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid,
      started_at: started14DaysPrior,
      agent_ip: mocks.agent.ip,
      service_id: service_id
    };
    const job = {
      attrs: {
        name: `MongoDB_${CONST.JOB.SERVICE_FABRIK_BACKUP}`,
        data: {},
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
    let baseJobLogRunHistoryStub;

    before(function () {
      backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
      mocks.cloudProvider.auth();
      mocks.cloudProvider.getContainer(container);
      baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
      baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
      return mocks.setup([backupStore.cloudProvider.getContainer()]);
    });

    afterEach(function () {
      baseJobLogRunHistoryStub.reset();
    });

    after(function () {
      baseJobLogRunHistoryStub.restore();
    });

    describe('#RunBackup', function () {
      it('should initiate service-fabrik backup, delete scheduled backup older than 14 days & backup operation status is succesful', function (done) {
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
        mocks.serviceBrokerClient.startServiceFabrikBackup(backupResponse);
        mocks.cloudProvider.list(container, prefixForDelete, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.list(mongoDBContainer, backup_guid, [
          backupFileName14DayspriorToDelete
        ]);
        mocks.cloudProvider.remove(`/${mongoDBContainer}${backupFileName14DayspriorToDelete}`);
        mocks.cloudProvider.remove(pathname14);
        mocks.serviceBrokerClient.getServiceFabrikBackupStatus(token);
        //Immediately post initiation when a check is done server responds with processing
        //on second call provide success.
        mocks.serviceBrokerClient.getServiceFabrikBackupStatus(token, 'succeeded');
        try {
          const old_frequency = config.mongodb.backup.status_check_every;
          config.mongodb.backup.status_check_every = 200;
          return ServiceFabrikBackupJob.run(job, () => {
            mocks.verify();
            const expectedBackupResponse = {
              name: 'backup',
              guid: backupResponse.backup_guid,
              token: token
            };
            config.mongodb.backup.status_check_every = old_frequency;
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

      it('should initiate service-fabrik backup, delete scheduled backup older than 14 days & backup operation status is failure', function (done) {
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
        mocks.serviceBrokerClient.startServiceFabrikBackup(backupResponse);
        mocks.cloudProvider.list(container, prefixForDelete, [
          fileName14Daysprior
        ]);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.list(mongoDBContainer, backup_guid, [
          backupFileName14DayspriorToDelete
        ]);
        mocks.cloudProvider.remove(`/${mongoDBContainer}${backupFileName14DayspriorToDelete}`);
        mocks.cloudProvider.remove(pathname14);
        mocks.serviceBrokerClient.getServiceFabrikBackupStatus(token);
        //Immediately post initiation when a check is done server responds with processing
        //on second call provide success.
        mocks.serviceBrokerClient.getServiceFabrikBackupStatus(token, 'failed');
        try {
          const old_frequency = config.mongodb.backup.status_check_every;
          config.mongodb.backup.status_check_every = 200;
          return ServiceFabrikBackupJob.run(job, () => {
            mocks.verify();
            config.mongodb.backup.status_check_every = old_frequency;
            expect(baseJobLogRunHistoryStub).to.be.calledOnce;
            const msg = `Service Fabrik backup failed`;
            const expectedErr = {
              statusCode: `ERR_FABRIK_BACKUP_failed`,
              statusMessage: msg
            };
            expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(expectedErr);
            expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql({});
            expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
            expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
            done();
          });
        } catch (ex) {
          console.log('exception occurred');
          mocks.verify();
        }
      });
    });
  });
});