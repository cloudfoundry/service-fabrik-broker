'use strict';

const lib = require('../../lib');
const app = require('../support/apps').internal;
const DBManager = require('../../lib/fabrik/DBManager');
const fabrik = lib.fabrik;
const config = lib.config;
const backupStore = lib.iaas.backupStore;
const filename = backupStore.filename;
const CONST = require('../../lib/constants');
const utils = require('../../lib/utils');

describe('service-fabrik-admin', function () {
  describe('internal-db-lifecycle', function () {
    /* jshint expr:true */
    const base_url = '/admin';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const time = Date.now();
    const started_at = isoDate(time);
    const container = backupStore.containerName;
    let timestampStub, uuidv4Stub;

    function isoDate(time) {
      return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
    }

    before(function () {
      config.mongodb.provision.plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      mocks.director.getBindingProperty(CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID, {}, config.mongodb.deployment_name, 'NOTFOUND');
      fabrik.dbManager = new DBManager();
      //By default config is not configured for DB. So just for the test cases in this suite
      //setting up plan id and reinitializing DBManager.
      backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
      mocks.cloudProvider.auth();
      mocks.cloudProvider.getContainer(container);
      timestampStub = sinon.stub(filename, 'timestamp');
      uuidv4Stub = sinon.stub(utils, 'uuidV4');
      timestampStub.withArgs().returns(started_at);
      uuidv4Stub.withArgs().returns(Promise.resolve(backup_guid));
      return mocks.setup([
        backupStore.cloudProvider.getContainer()
      ]);
    });

    afterEach(function () {
      mocks.reset();
      timestampStub.reset();
      uuidv4Stub.reset();
    });

    after(function () {
      timestampStub.restore();
      uuidv4Stub.restore();
      delete config.mongodb.provision.plan_id;
    });

    describe('create', function () {
      let clock;

      beforeEach(function () {
        clock = sinon.useFakeTimers(new Date().getTime());
      });

      it('should provision service fabrik internal mongodb when deployment not found', function (done) {
        const WAIT_TIME_FOR_ASYNCH_CREATE_DEPLOYMENT_OPERATION = 30;
        this.timeout(2000 + WAIT_TIME_FOR_ASYNCH_CREATE_DEPLOYMENT_OPERATION);
        mocks.director.getBindingProperty(CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID, {}, config.mongodb.deployment_name, 'NOTFOUND');
        mocks.director.getDeployment(config.mongodb.deployment_name, false, undefined, 2);
        mocks.director.getDeploymentInstances(config.mongodb.deployment_name);
        mocks.director.createOrUpdateDeployment('777');
        mocks.director.getDeploymentTask('777', 'done');
        mocks.agent.getInfo();
        mocks.agent.createCredentials();
        config.directors[0].default_task_poll_interval = 10;
        mocks.director.createBindingProperty(CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID, {}, config.mongodb.deployment_name);
        return chai
          .request(app)
          .post(`${base_url}/service-fabrik/db`)
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            clock.tick(config.directors[0].default_task_poll_interval);
            expect(res.body.status).to.be.oneOf(['CREATE_UPDATE_IN_PROGRESS', 'DISCONNECTED']);
            expect(res.body.url).to.eql('');
            expect(res).to.have.status(202);
            clock.restore();
            setTimeout(() => {
              mocks.verify();
              done();
            }, WAIT_TIME_FOR_ASYNCH_CREATE_DEPLOYMENT_OPERATION);
          });
      });
    });

    describe('update', function () {
      let clock;
      beforeEach(function () {
        clock = sinon.useFakeTimers(new Date().getTime());
      });
      it('should update service fabrik internal mongodb deployment ', function (done) {
        const WAIT_TIME_FOR_ASYNCH_CREATE_DEPLOYMENT_OPERATION = 5;
        mocks.director.getDeployment(config.mongodb.deployment_name, true);
        mocks.director.getDeployment(config.mongodb.deployment_name, true);
        mocks.director.createOrUpdateDeployment('777');
        mocks.director.getDeploymentTask('777', 'done');
        config.directors[0].default_task_poll_interval = 10;
        return chai
          .request(app)
          .put(`${base_url}/service-fabrik/db`)
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            clock.tick(config.directors[0].default_task_poll_interval);
            expect(res.body.status).to.be.oneOf(['CREATE_UPDATE_IN_PROGRESS', 'DISCONNECTED']);
            expect(res.body.url).to.be.oneOf([mocks.agent.credentials.uri, '']);
            clock.restore();
            //If test case is run in isolation then URI will be blank initially.
            //However if the test suite is run, then create operation sets the URI which will be returned as part of update.
            expect(res).to.have.status(202);
            setTimeout(() => {
              mocks.verify();
              done();
            }, WAIT_TIME_FOR_ASYNCH_CREATE_DEPLOYMENT_OPERATION);
          });
      });
    });

  });
});