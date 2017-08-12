'use strict';

const _ = require('lodash');
const lib = require('../../lib');
const logger = lib.logger;
const app = require('../../apps').internal;
const config = lib.config;
const bosh = require('../../lib/bosh');
const backupStore = lib.iaas.backupStoreForOob;
const filename = backupStore.filename;
const CONST = require('../../lib/constants');
const utils = require('../../lib/utils');
const ScheduleManager = require('../../lib/jobs/ScheduleManager');

describe('service-fabrik-admin', function () {
  describe('oob-deployment', function () {
    /* jshint expr:true */
    const base_url = '/admin';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const deployment_name = 'ccdb';
    const no_of_directors = 3;
    const callsForStatus = no_of_directors;
    const callsForInitiate = no_of_directors * 3;
    const director = bosh.director;
    const root_folder_name = CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME;
    const director_url = _
      .reduce(config.directors,
        (bootstrap, director) => {
          if (director.name === CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH) {
            return director;
          } else {
            return bootstrap;
          }
        }, null).url;
    const time = Date.now();
    const started_at = isoDate(time);
    const container = backupStore.containerName;
    const operation_backup = 'backup';
    const operation_restore = 'restore';
    const filenameObject = {
      operation: operation_backup,
      deployment_name: deployment_name,
      backup_guid: backup_guid,
      started_at: time,
      root_folder: root_folder_name
    };
    const restoreFilenameObject = {
      operation: operation_restore,
      deployment_name: deployment_name,
      root_folder: root_folder_name
    };
    const deploymentVms = [{
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'postgresql_master_z1',
      index: 0,
      id: '9b199ea6-94a3-463d-b3d4-4d4fe89cc364'
    }, {
      agent_id: '21dd1d0a-0f53-4485-8927-78c9857fa0f2',
      cid: '3ffaefe0-e59b-43cc-4f25-940dfc12aeb5',
      job: 'postgresql_slave_z1',
      index: 1,
      id: '9b199ea6-94a3-463d-b3d4-4d4fe89cc364'
    }];
    const filenameObj = filename.create(filenameObject).name;
    const restoreFileName = filename.create(restoreFilenameObject).name;
    const pathname = `/${container}/${filenameObj}`;
    const restorePathname = `/${container}/${restoreFileName}`;
    const prefix = `${root_folder_name}/${operation_backup}/${deployment_name}.${backup_guid}`;
    const data = {
      backup_guid: backup_guid,
      deployment_name: deployment_name,
      state: 'succeeded',
      logs: [],
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED
    };
    const restore_data = {
      state: 'succeeded',
      agent_ip: mocks.agent.ip,
      backup_guid: backup_guid,
      deployment_name: deployment_name
    };
    let timestampStub, uuidv4Stub, scheduleStub;

    function isoDate(time) {
      return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
    }

    before(function () {
      mocks.reset();
      backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
      mocks.cloudProvider.auth();
      mocks.cloudProvider.getContainer(container);
      timestampStub = sinon.stub(filename, 'timestamp');
      uuidv4Stub = sinon.stub(utils, 'uuidV4');
      timestampStub.withArgs().returns(started_at);
      uuidv4Stub.withArgs().returns(Promise.resolve(backup_guid));
      scheduleStub = sinon.stub(ScheduleManager, 'schedule', () => Promise.resolve({}));
      return mocks.setup([
        backupStore.cloudProvider.getContainer()
      ]);
    });

    beforeEach(function () {
      director.clearCache();
    });


    afterEach(function () {
      mocks.reset();
      scheduleStub.reset();
      timestampStub.reset();
      uuidv4Stub.reset();
    });
    after(function () {
      scheduleStub.restore();
      timestampStub.restore();
      uuidv4Stub.restore();
    });

    describe('backup', function () {
      beforeEach(function () {
        director.clearCache();
      });
      it('should list all backups for ccdb deployment', function () {
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup`)
          .query({
            backup_guid: backup_guid
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body.backups).to.have.length(1);
            expect(res.body.backups[0]).to.eql(data);
            expect(res).to.have.status(200);
            mocks.verify();
          });
      });

      it('should initiate ccdb backup operation successfully', function () {
        mocks.director.getDeploymentManifest(2);
        mocks.director.getDeployments({
          'noOfTimes': callsForInitiate,
          'oob': true
        });
        mocks.director.getDeploymentVms(deployment_name, deploymentVms);
        mocks.agent.getInfo();
        mocks.agent.startBackup();
        const type = 'online';
        logger.debug(`uploading json here:--> ${pathname}`);
        mocks.cloudProvider.upload(pathname, body => {
          expect(body.type).to.equal(type);
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.trigger).to.equal(CONST.BACKUP.TRIGGER.SCHEDULED);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.cloudProvider.headObject(pathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/backup`)
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(scheduleStub).to.be.calledOnce;
            expect(res).to.have.status(202);
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_backup);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
            mocks.verify();
          });
      });

      it('should return the status of last ccdb backup operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'backup'
        });
        const backupState = {
          state: 'processing',
          stage: 'Creating volume',
          updated_at: started_at
        };
        mocks.director.getDeployments({
          'noOfTimes': callsForStatus,
          'oob': true
        });
        mocks.director.getDeploymentManifest();
        mocks.agent.lastBackupOperation(backupState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup/status`)
          .query({
            token: token
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body).to.eql(backupState);
            mocks.verify();
          });
      });


      it('should list all backups for bootstrap bosh deployment', function () {
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup`)
          .query({
            backup_guid: backup_guid,
            bosh_director: CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body.backups).to.have.length(1);
            expect(res.body.backups[0]).to.eql(data);
            expect(res).to.have.status(200);
            mocks.verify();
          });
      });

      it('should initiate bootstrap bosh deployment backup operation successfully', function () {
        director.clearCache();
        mocks.director.getDeploymentManifest(2, director_url);
        mocks.director.getDeploymentVms(deployment_name, deploymentVms, director_url);
        mocks.director.getDeployments({
          'noOfTimes': callsForInitiate,
          'oob': true
        });
        mocks.agent.getInfo();
        mocks.agent.startBackup();
        const type = 'online';
        logger.debug(`uploading json here:--> ${pathname}`);
        mocks.cloudProvider.upload(pathname, body => {
          expect(body.type).to.equal(type);
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.trigger).to.equal(CONST.BACKUP.TRIGGER.SCHEDULED);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.cloudProvider.headObject(pathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/backup`)
          .send({
            bosh_director: CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(scheduleStub).to.be.calledOnce;
            expect(res).to.have.status(202);
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_backup);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
          });
      });

      it('should return the status of last bootstrap bosh deployment backup operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'backup'
        });
        const backupState = {
          state: 'processing',
          stage: 'Creating volume',
          updated_at: started_at
        };
        mocks.director.getDeployments({
          'noOfTimes': callsForStatus,
          'oob': true
        });
        mocks.director.getDeployment(deployment_name, true, director_url);
        mocks.agent.lastBackupOperation(backupState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/backup/status`)
          .query({
            token: token,
            bosh_director: CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body).to.eql(backupState);
          });
      });
    });

    describe('restore', function () {
      beforeEach(function () {
        director.clearCache();
      });
      it('should list restore info for ccdb', function () {
        mocks.cloudProvider.download(restorePathname, restore_data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore`)
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body.restore).to.eql(_.omit(restore_data, 'agent_ip'));
          });
      });


      it('should initiate ccdb restore operation successfully', function () {
        mocks.director.getDeployment(deployment_name, true);
        mocks.director.getDeploymentManifest();
        mocks.director.getDeploymentVms(deployment_name, deploymentVms);
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        mocks.agent.getInfo();
        mocks.agent.startRestore();
        logger.debug(`uploading json here: ${pathname}`);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.director.getDeployments({
          'noOfTimes': callsForInitiate,
          'oob': true
        });
        mocks.cloudProvider.headObject(restorePathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .send({
            backup_guid: backup_guid
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(scheduleStub).to.be.calledOnce;
            expect(res).to.have.status(202);
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_restore);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
            mocks.verify();
          });
      });

      it('should return the status of ccdb restore operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'restore'
        });
        const restoreState = {
          state: 'processing',
          stage: 'Restoring ...',
          updated_at: started_at
        };
        mocks.director.getDeployments({
          'noOfTimes': callsForStatus,
          'oob': true
        });
        mocks.director.getDeployment(deployment_name, true);
        mocks.agent.lastRestoreOperation(restoreState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore/status`)
          .query({
            token: token
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body).to.eql(restoreState);
            mocks.verify();
          });
      });

      it('res should return the status of last ccdb restore operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'restore'
        });
        const restoreState = {
          state: 'processing',
          stage: 'Restoring ...',
          updated_at: started_at
        };
        mocks.director.getDeployments({
          'noOfTimes': callsForStatus,
          'oob': true
        });
        mocks.director.getDeployment(deployment_name, true);
        mocks.agent.lastRestoreOperation(restoreState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore/status`)
          .query({
            token: token
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res.body).to.eql(restoreState);
            mocks.verify();
          });
      });

      it('should list restore info for bootstrap bosh deployment', function () {
        mocks.cloudProvider.download(restorePathname, restore_data);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore`)
          .query({
            bosh_director: CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body.restore).to.eql(_.omit(restore_data, 'agent_ip'));
          });
      });

      it('should initiate bootstrap bosh deployment restore operation successfully', function () {
        mocks.director.getDeployment(deployment_name, true, director_url);
        mocks.director.getDeploymentManifest(1, director_url);
        mocks.director.getDeploymentVms(deployment_name, deploymentVms, director_url);
        mocks.cloudProvider.list(container, prefix, [filenameObj]);
        mocks.cloudProvider.download(pathname, data);
        mocks.agent.getInfo();
        mocks.agent.startRestore();
        logger.debug(`uploading json here: ${pathname}`);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.username).to.equal(config.username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.state).to.equal('processing');
          return true;
        });
        mocks.director.getDeployments({
          'noOfTimes': callsForInitiate,
          'oob': true
        });
        mocks.cloudProvider.headObject(restorePathname);
        return chai
          .request(app)
          .post(`${base_url}/deployments/${deployment_name}/restore`)
          .send({
            backup_guid: backup_guid,
            bosh_director: CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res).to.have.status(202);
            expect(scheduleStub).to.be.calledOnce;
            expect(res.body.backup_guid).to.eql(backup_guid);
            expect(res.body.operation).to.eql(operation_restore);
            expect(utils.decodeBase64(res.body.token).agent_ip).to.eql(mocks.agent.ip);
          });
      });

      it('should return the status of bootstrap bosh deployment restore operation', function () {
        const token = utils.encodeBase64({
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          operation: 'restore'
        });
        const restoreState = {
          state: 'processing',
          stage: 'Restoring ...',
          updated_at: started_at
        };
        mocks.director.getDeployments({
          'noOfTimes': callsForStatus,
          'oob': true
        });
        mocks.director.getDeployment(deployment_name, true, director_url);
        mocks.agent.lastRestoreOperation(restoreState);
        return chai
          .request(app)
          .get(`${base_url}/deployments/${deployment_name}/restore/status`)
          .query({
            token: token,
            bosh_director: CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            mocks.verify();
            expect(res.body).to.eql(restoreState);
          });
      });

    });
  });
});