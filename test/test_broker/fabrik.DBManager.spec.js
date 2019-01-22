'use strict';

const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const _ = require('lodash');
const BoshDirectorClient = require('../../data-access-layer/bosh/BoshDirectorClient');
const errors = require('../../common/errors');
const config = require('../../common/config');
const utils = require('../../common/utils');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const DBManagerNoProxy = require('../../data-access-layer/db/DBManager/DBManager');

let bindPropertyFound = 0;
let bindPropertyFoundOnApiServer = false;
let failCreateUpdate = false;
const mongoDBUrl = 'mongodb://username:password@10.11.0.2:27017,10.11.0.3:27017,10.11.0.4:27017/service-fabrik';
let dbConnectionState = 1;
class DirectorServiceStub {
  getBindingProperty() {
    return Promise.try(() => {
      if (bindPropertyFound === 0) {
        return {
          credentials: {
            uri: mongoDBUrl
          }
        };
      } else if (bindPropertyFound === 1) {
        throw new errors.ServiceBindingNotFound('SF Mongodb binding not found...Expected error.');
      } else {
        throw new errors.ServiceUnavailable('BOSH is down... simulated failure. Expected error.!');
      }
    });
  }
  createBinding() {
    return Promise.resolve({
      credentials: {
        uri: mongoDBUrl
      }
    });
  }
  createOrUpdateDeployment() {
    return Promise.try(() => {
      if (!failCreateUpdate) {
        return {
          task_id: '1234'
        };
      }
      throw new errors.ServiceUnavailable('Bosh is down... simulated failure. Expected error.!');
    });
  }
}

let eventMeshStub = {
  apiServerClient: {
    getResource: () => {
      return Promise.try(() => {
        if (bindPropertyFoundOnApiServer) {
          return {
            status: {
              response: utils.encodeBase64({
                credentials: {
                  uri: mongoDBUrl
                }
              })
            }
          };
        } else {
          throw new errors.NotFound('resource not found on ApiServer');
        }
      });
    },
    deleteResource: () => {
      if (bindPropertyFoundOnApiServer) {
        return Promise.resolve();
      } else {
        return Promise.try(() => {
          throw new errors.NotFound('resource not found on ApiServer');
        });
      }
    },
    createResource: () => {
      return Promise.resolve();
    }
  }
};

let errorOnDbStart = false;
const proxyLibs = {
  '../../../common/config': {
    mongodb: {
      provision: {
        plan_id: 'd616b00a-5949-4b1c-bc73-0d3c59f3954a',
        network_index: 1
      },
      deployment_name: 'service-fabrik-mongodb-new',
      retry_connect: {
        max_attempt: 5,
        min_delay: 0
      },
      record_max_fetch_count: 100,
      bosh_job_name: 'broker_mongodb'
    }
  },
  '../../../data-access-layer/db/DbConnectionManager': {
    startUp: () => Promise.try(() => {
      if (errorOnDbStart) {
        throw new errors.ServiceUnavailable('DB Down...Simulated expected test error.');
      }
      return Promise.resolve({});
    }),
    getConnectionStatus: () => dbConnectionState,
    shutDown: () => Promise.resolve({})
  },
  '../../../operators/bosh-operator/DirectorService': DirectorServiceStub,
  '../../../common/models/Catalog': {
    getPlan: () => {}
  },
  '../../../data-access-layer/eventmesh': eventMeshStub
};

const DBManager = proxyquire('../../data-access-layer/db/DBManager/DBManager', proxyLibs);
const proxyLib0 = _.cloneDeep(proxyLibs);
delete proxyLib0['../../../common/config'].mongodb.deployment_name;
const DBManagerWithUndefinedDeploymentName = proxyquire('../../data-access-layer/db/DBManager/DBManager', proxyLib0);
const proxyLib1 = _.cloneDeep(proxyLibs);
delete proxyLib1['../../../common/config'].mongodb.provision.network_index;
const DBManagerWithUndefinedNetworkSegmentIdx = proxyquire('../../data-access-layer/db/DBManager/DBManager', proxyLib1);
const proxyLib2 = _.cloneDeep(proxyLibs);
proxyLib2['../../../common/config'].mongodb.deployment_name = 'service-fabrik-mongodb';
const DBManagerForUpdate = proxyquire('../../data-access-layer/db/DBManager/DBManager', proxyLib2);
const proxyLib3 = _.cloneDeep(proxyLibs);
delete proxyLib3['../../../common/config'].mongodb.provision;
delete proxyLib3['../../../common/config'].mongodb.deployment_name;
proxyLib3['../../../common/config'].mongodb.url = 'mongodb://user:pass@localhost:27017/service-fabrik';
const DBManagerByUrl = proxyquire('../../data-access-layer/db/DBManager/DBManager', proxyLib3);
const proxyLib4 = _.cloneDeep(proxyLibs);
proxyLib4['../../../common/config'].mongodb.retry_connect.min_delay = 120000;
const DBManagerCreateWithDelayedReconnectRetry = proxyquire('../../data-access-layer/db/DBManager/DBManager', proxyLib4);

describe('fabrik', function () {
  /* jshint unused:false */
  /* jshint expr:true */
  describe('DBManager', function () {
    let sandbox, getDeploymentVMsStub, getDeploymentStub, pollTaskStatusTillCompleteStub,
      loggerWarnSpy, dbInitializeSpy, dbInitializeByUrlSpy, dbInitializeForCreateSpy, dbCreateUpdateSucceededSpy, retryStub;
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
    let errorPollTask = false;
    before(function () {
      sandbox = sinon.createSandbox();
      loggerWarnSpy = sandbox.spy(logger, 'warn');
      retryStub = sandbox.stub(utils, 'retry').callsFake((callback, options) => callback());
      dbInitializeSpy = sinon.spy(DBManager.prototype, 'initialize');
      dbInitializeForCreateSpy = sinon.spy(DBManagerCreateWithDelayedReconnectRetry.prototype, 'initialize');
      dbInitializeByUrlSpy = sinon.spy(DBManagerByUrl.prototype, 'initialize');
      dbCreateUpdateSucceededSpy = sandbox.spy(DBManagerForUpdate.prototype, 'dbCreateUpdateSucceeded');
      getDeploymentVMsStub = sandbox.stub(BoshDirectorClient.prototype, 'getDeploymentVms');
      getDeploymentStub = sandbox.stub(BoshDirectorClient.prototype, 'getDeployment');
      pollTaskStatusTillCompleteStub = sandbox.stub(BoshDirectorClient.prototype, 'pollTaskStatusTillComplete').callsFake(
        () => Promise.try(() => {
          if (errorPollTask) {
            throw new errors.ServiceUnavailable('Bosh Down...');
          }
          return {};
        }));
      getDeploymentVMsStub.withArgs().returns(Promise.resolve(deploymentVms));
      getDeploymentStub.withArgs('service-fabrik-mongodb-new').returns(deferred.promise);
      getDeploymentStub.withArgs('service-fabrik-mongodb').returns(Promise.resolve({}));
    });

    afterEach(function () {
      getDeploymentStub.resetHistory();
      getDeploymentVMsStub.resetHistory();
      pollTaskStatusTillCompleteStub.resetHistory();
      loggerWarnSpy.reset();
      dbInitializeSpy.reset();
      dbInitializeByUrlSpy.reset();
      retryStub.resetHistory();
      dbCreateUpdateSucceededSpy.reset();
    });
    after(function () {
      sandbox.restore();
    });

    describe('#Initialize', function () {
      let configStub, initSandbox, proxyDBUrl;
      before(function () {
        initSandbox = sinon.createSandbox();
        configStub = sandbox.stub(config);
      });
      beforeEach(function () {
        bindPropertyFound = 0;
      });
      afterEach(function () {
        errorOnDbStart = false;
      });
      after(function () {
        initSandbox.restore();
      });
      const validateConnected = (dbManager, expectedInitCount) => {
        return Promise.delay(10).then(() => {
          expect(dbManager.dbState).to.eql(CONST.DB.STATE.CONNECTING);
          (expectedInitCount === 1) ? expect(dbInitializeSpy).to.be.calledOnce: expect(dbInitializeSpy.callCount >= 2).to.eql(true);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbManager.dbInitialized).to.eql(true);
        });
      };
      it('Initialization must return if mongodb configuration not found', function () {
        const dbMgr = new DBManagerNoProxy();
        return Promise.delay(5).then(() => {
          expect(dbMgr.dbState).to.eql(CONST.DB.STATE.NOT_CONFIGURED);
        });
      });
      it('If just plan name is configured with no deployment name, then initialization must return back', function () {
        const dbMgr = new DBManagerWithUndefinedDeploymentName();
        return Promise.delay(5).then(() => {
          expect(dbMgr.dbState).to.eql(CONST.DB.STATE.NOT_CONFIGURED);
        });
      });
      it('should initalize & connect to existing mongodb', function () {
        const dbManager = new DBManager();
        return validateConnected(dbManager, 1);
      });
      it('On start if binding property cannot be retrieved then keep trying till it succeeds', function () {
        bindPropertyFound = 2;
        const dbManager = new DBManager();
        return Promise.delay(10).then(() => {
          expect(dbManager.dbState).to.eql(CONST.DB.STATE.TB_INIT);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbManager.dbInitialized).to.eql(false);
          bindPropertyFound = 0;
          return validateConnected(dbManager);
        });
      });
      it('On start if binding property is found in ApiServer then no further calls to director are made', function () {
        bindPropertyFoundOnApiServer = true;
        bindPropertyFound = 1; //ensure bindProperty won't be found on Director 
        const dbManager = new DBManager();
        return Promise.delay(10).then(() => {
          expect(dbManager.dbState).to.eql(CONST.DB.STATE.CONNECTING);
          expect(dbManager.dbInitialized).to.eql(true);
          bindPropertyFound = 0;
          bindPropertyFoundOnApiServer = false;
          return validateConnected(dbManager, 1);
        });
      });
      it('On start if mongodb URL is configured, then it must connect to it successfully', function () {
        const dbManager = new DBManagerByUrl();
        return Promise.delay(20).then(() => {
          expect(dbManager.dbState).to.eql(CONST.DB.STATE.CONNECTING);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbManager.dbInitialized).to.eql(true);
        });
      });
      it('On start if mongodb URL is configured, try to connect & if it errors, then retry', function () {
        errorOnDbStart = true;
        const dbManager = new DBManagerByUrl();
        return Promise.delay(10).then(() => {
          const validStatesDuringDBStartError = [CONST.DB.STATE.CONNECTION_FAILED, CONST.DB.STATE.CONNECTING, CONST.DB.STATE.TB_INIT];
          expect(validStatesDuringDBStartError).to.include(dbManager.dbState);
          expect(dbInitializeByUrlSpy.callCount >= 2).to.eql(true);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbManager.dbInitialized).to.eql(false);
        });
      });
    });

    describe('#create', function () {
      beforeEach(function () {
        bindPropertyFound = 1;
      });
      afterEach(function () {
        errorPollTask = false;
      });
      it('If just plan name is configured with no deployment name, then create operation should just log error and return', function () {
        const dbMgr = new DBManagerWithUndefinedDeploymentName();
        return Promise.delay(5)
          .then(() => expect(dbMgr.dbState).to.eql(CONST.DB.STATE.NOT_CONFIGURED))
          .then(() => dbMgr.createOrUpdateDbDeployment(true))
          .then(() => {
            throw new Error('Create deployment should have errorred');
          })
          .catch((err) => expect(err instanceof errors.PreconditionFailed).to.eql(true));
      });
      it('If network segment index is not configured, then create should throw error', function () {
        deferred.reject(new errors.NotFound('Deployment not found'));
        const dbMgr = new DBManagerWithUndefinedNetworkSegmentIdx();
        return Promise.delay(5)
          .then(() => expect(dbMgr.dbState).to.eql(CONST.DB.STATE.TB_INIT))
          .then(() => dbMgr.createOrUpdateDbDeployment(true))
          .then(() => {
            throw new Error('Create deployment should have errorred');
          })
          .catch((err) => expect(err instanceof errors.PreconditionFailed).to.eql(true));
      });
      it('DB create should fail when deployment is already existing & create flag is set to true for creation', function () {
        const dbManager = new DBManagerForUpdate();
        return Promise.delay(2).then(() => {
          return dbManager.createOrUpdateDbDeployment(true).catch(errors.BadRequest, error => {});
        });
      });

      it('should provision & connect to MongoDB Successfully', function () {
        const dbManager = new DBManager();
        deferred.reject(new errors.NotFound('Deployment not found'));
        return Promise.delay(2).then(() => {
          expect(dbManager.dbState).to.eql(CONST.DB.STATE.TB_INIT);
          expect(loggerWarnSpy).to.be.calledOnce;
          expect(loggerWarnSpy.firstCall.args[1] instanceof errors.ServiceBindingNotFound).to.eql(true);
          let taskId;
          return dbManager.createOrUpdateDbDeployment(true)
            .tap(out => taskId = out.task_id)
            .then(() => Promise.delay(3))
            .then(() => {
              expect(getDeploymentStub).to.be.calledOnce;
              expect(getDeploymentStub.firstCall.args[0]).to.eql('service-fabrik-mongodb-new');
              expect(pollTaskStatusTillCompleteStub).to.be.calledOnce;
              expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql(taskId);
              expect(dbManager.dbState).to.eql(CONST.DB.STATE.CONNECTING);
              expect(dbManager.dbInitialized).to.eql(true);
            });
        });
      });

      it('Should gracefully handle BOSH errors while creating deployment', function () {
        errorPollTask = true;
        const dbManager = new DBManager();
        deferred.reject(new errors.NotFound('Deployment not found'));
        return Promise.delay(2).then(() => {
          expect(dbManager.dbState).to.eql(CONST.DB.STATE.TB_INIT);
          expect(loggerWarnSpy).to.be.calledOnce;
          expect(loggerWarnSpy.firstCall.args[1] instanceof errors.ServiceBindingNotFound).to.eql(true);
          let taskId;
          return dbManager.createOrUpdateDbDeployment(true)
            .tap(out => taskId = out.task_id)
            .then(() => Promise.delay(3))
            .then(() => {
              throw new Error('Create deployment should have errorred');
            })
            .catch((err) => {
              expect(getDeploymentStub).to.be.calledOnce;
              expect(getDeploymentStub.firstCall.args[0]).to.eql('service-fabrik-mongodb-new');
              expect(pollTaskStatusTillCompleteStub).to.be.calledOnce;
              expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql(taskId);
              expect(dbManager.dbState).to.eql(CONST.DB.STATE.CREATE_UPDATE_FAILED);
              expect(dbManager.dbInitialized).to.eql(false);
            });
        });
      });
      it('At start of app, binding retrieval from BOSH fails & then subsequent create operation should provision mongodb and connect to DB Successfully', function () {
        this.timeout(25000);
        bindPropertyFound = 2;
        const dbManager = new DBManagerCreateWithDelayedReconnectRetry();
        deferred.reject(new errors.NotFound('Deployment not found'));
        return Promise.delay(5).then(() => {
          expect(dbManager.dbState).to.eql(CONST.DB.STATE.TB_INIT);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbInitializeForCreateSpy).called;
          bindPropertyFound = 1;
          let taskId;
          return dbManager
            .createOrUpdateDbDeployment(true)
            .tap(out => taskId = out.task_id)
            .then(() => Promise.delay(10))
            .then(() => {
              expect(getDeploymentStub).to.be.calledOnce;
              expect(getDeploymentStub.firstCall.args[0]).to.eql('service-fabrik-mongodb-new');
              expect(pollTaskStatusTillCompleteStub).to.be.calledOnce;
              expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql(taskId);
              expect(dbManager.dbState).to.eql(CONST.DB.STATE.CONNECTING);
              expect(dbManager.dbInitialized).to.eql(true);
            });
        });
      });
    });

    describe('#update', function () {
      beforeEach(function () {
        bindPropertyFound = 0;
      });
      afterEach(function () {
        failCreateUpdate = false;
      });
      it('DB update should fail when deployment not found & create flag is false', function () {
        deferred.reject(new errors.NotFound('Deployment not found'));
        const dbManager = new DBManager();
        return Promise.delay(2).then(() => {
          return dbManager.createOrUpdateDbDeployment(false).catch(errors.NotFound, error => {});
        });
      });
      it('DB update should succeed when deployment is found', function () {
        const dbManagerForUpdate = new DBManagerForUpdate();
        return Promise.delay(5).then(() => {
          expect(dbManagerForUpdate.dbState).to.eql(CONST.DB.STATE.CONNECTING);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbManagerForUpdate.dbInitialized).to.eql(true);
          let taskId;
          return dbManagerForUpdate.createOrUpdateDbDeployment(false)
            .then(out => {
              taskId = out.task_id;
              expect(dbManagerForUpdate.dbInitialized).to.eql(false);
              const validStatesDuringCreation = [CONST.DB.STATE.TB_INIT];
              expect(validStatesDuringCreation).to.include(dbManagerForUpdate.dbState);
              //Can be any one of the state
            })
            .then(() => Promise.delay(10))
            .then(() => {
              expect(getDeploymentStub).to.be.calledOnce;
              expect(getDeploymentStub.firstCall.args[0]).to.eql('service-fabrik-mongodb');
              expect(pollTaskStatusTillCompleteStub).to.be.calledOnce;
              expect(pollTaskStatusTillCompleteStub.firstCall.args[0]).to.eql(taskId);
              expect(dbManagerForUpdate.dbState).to.eql(CONST.DB.STATE.CONNECTING);
              expect(dbManagerForUpdate.dbInitialized).to.eql(true);
            });
        });
      });
      it('DB update should succeed but get binding must fail which should result in retrying the operation', function () {
        bindPropertyFound = 2;
        const dbManagerForUpdate = new DBManagerForUpdate();
        return Promise.delay(2).then(() => {
          expect(dbManagerForUpdate.dbState).to.eql(CONST.DB.STATE.TB_INIT);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbManagerForUpdate.dbInitialized).to.eql(false);
          let taskId;
          bindPropertyFound = 2;
          return dbManagerForUpdate.createOrUpdateDbDeployment(false)
            .then(out => {
              taskId = out.task_id;
              expect(dbManagerForUpdate.dbInitialized).to.eql(false);
              expect(dbManagerForUpdate.dbState).to.eql(CONST.DB.STATE.BIND_IN_PROGRESS);
            })
            .then(() => Promise.delay(5))
            .then(() => {
              expect(dbCreateUpdateSucceededSpy.callCount >= 2).to.eql(true);
              expect(dbManagerForUpdate.dbInitialized).to.eql(false);
              const validStatesDuringRetry = [CONST.DB.STATE.TB_INIT, CONST.DB.STATE.BIND_FAILED, CONST.DB.STATE.BIND_IN_PROGRESS];
              //While retrying the operaiton, it can be in either of the states.
              expect(validStatesDuringRetry).to.include(dbManagerForUpdate.dbState);
            });
        });
      });
      it('DB update failures should be handled gracefully', function () {
        const dbManagerForUpdate = new DBManagerForUpdate();
        return Promise.delay(10).then(() => {
          failCreateUpdate = true;
          expect(dbManagerForUpdate.dbState).to.eql(CONST.DB.STATE.CONNECTING);
          expect(loggerWarnSpy).not.to.be.called;
          expect(dbManagerForUpdate.dbInitialized).to.eql(true);
          let taskId;
          return dbManagerForUpdate.createOrUpdateDbDeployment(false)
            .then(out => {
              expect(dbManagerForUpdate.dbState).to.include(CONST.DB.STATE.CREATE_UPDATE_FAILED);
              expect(dbManagerForUpdate.dbInitialized).to.eql(false);
            });
        });
      });
    });

    describe('#getState', function () {
      afterEach(function () {
        bindPropertyFound = 0;
        failCreateUpdate = false;
      });
      it('get state of DB state of connected successfully', function () {
        const dbManagerForUpdate = new DBManagerForUpdate();
        return Promise.delay(2).then(() => {
          dbConnectionState = 1;
          const expectedResponse = {
            status: CONST.DB.STATE.CONNECTED,
            url: mongoDBUrl
          };
          let dbState = dbManagerForUpdate.getState();
          expect(dbState).to.eql(expectedResponse);

          dbConnectionState = 2;
          dbState = dbManagerForUpdate.getState();
          expectedResponse.status = CONST.DB.STATE.DISCONNECTED;
          expect(dbState).to.eql(expectedResponse);

          dbConnectionState = 3;
          dbState = dbManagerForUpdate.getState();
          expectedResponse.status = CONST.DB.STATE.SHUTTING_DOWN;
          expect(dbState).to.eql(expectedResponse);
        });
      });
    });

  });
});