'use strict';

const lib = require('../../broker/lib');
const _ = require('lodash');
const proxyquire = require('proxyquire');
const logger = require('../../broker/lib/logger');
const DirectorManager = lib.fabrik.DirectorManager;
const BoshDirectorClient = lib.bosh.BoshDirectorClient;
const CONST = require('../../broker/lib/constants');
const errors = require('../../broker/lib/errors');
const ServiceFabrikClient = require('../../broker/lib/cf/ServiceFabrikClient');
const ServiceFabrikOperation = require('../../broker/lib/fabrik/ServiceFabrikOperation');

describe('fabrik', function () {
  describe('FabrikStatusPoller', function () {
    /* jshint expr:true */
    let sandbox, startStub, directorOperationStub, serviceFabrikClientStub, serviceFabrikOperationStub,
      getDirectorConfigStub, failUnlock, restartSpy;
    const index = mocks.director.networkSegmentIndex;
    const time = Date.now();
    const IN_PROGRESS_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const SUCCEEDED_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180bs';
    const ABORTING_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180ba';
    const UNLOCK_FAILED_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180bc';
    const instanceInfo = {
      tenant_id: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
      instance_guid: mocks.director.uuidByIndex(index),
      agent_ip: '10.10.0.15',
      service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
      plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
      deployment: mocks.director.deploymentNameByIndex(index),
      started_at: time
    };
    const instanceInfo_InProgress = _.clone(instanceInfo);
    _.set(instanceInfo_InProgress, 'backup_guid', IN_PROGRESS_BACKUP_GUID);
    const instanceInfo_Succeeded = _.clone(instanceInfo);
    _.set(instanceInfo_Succeeded, 'backup_guid', SUCCEEDED_BACKUP_GUID);
    const instanceInfo_aborting = _.clone(instanceInfo);
    _.set(instanceInfo_aborting, 'backup_guid', ABORTING_BACKUP_GUID);
    const instanceInfo_unlock_failed = _.clone(instanceInfo);
    _.set(instanceInfo_unlock_failed, 'backup_guid', UNLOCK_FAILED_BACKUP_GUID);

    const directorConfigStub = {
      lock_deployment_max_duration: 30000
    };
    const config = {
      backup: {
        status_check_every: 10,
        abort_time_out: 180000,
        retry_delay_on_error: 10,
        lock_check_delay_on_restart: 0
      }
    };
    const FabrikStatusPoller = proxyquire('../../broker/lib/fabrik/FabrikStatusPoller', {
      '../config': config
    });

    describe('#PollOperation', function () {
      before(function () {
        sandbox = sinon.sandbox.create();
        directorOperationStub = sandbox.stub(DirectorManager.prototype, 'getServiceFabrikOperationState');
        serviceFabrikClientStub = sandbox.stub(ServiceFabrikClient.prototype, 'abortLastBackup');
        serviceFabrikOperationStub = sandbox.stub(ServiceFabrikOperation.prototype, 'invoke', () => Promise.try(() => {
          logger.warn('Unlock must fail:', failUnlock);
          if (failUnlock) {
            throw new errors.InternalServerError('Simulated expected test error...');
          }
          return {};
        }));
        getDirectorConfigStub = sandbox.stub(BoshDirectorClient.prototype, 'getDirectorConfig');
        getDirectorConfigStub.withArgs(instanceInfo.deployment).returns(directorConfigStub);
        directorOperationStub.withArgs('backup', instanceInfo_InProgress).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          description: 'Backup operation in-progress'
        }));
        directorOperationStub.withArgs('backup', instanceInfo_aborting).onCall(0).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTING,
          description: 'Backup operation abort in-progress'
        }));
        directorOperationStub.withArgs('backup', instanceInfo_aborting).onCall(1).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTED,
          description: 'Backup operation aborted'
        }));
        directorOperationStub.withArgs('backup', instanceInfo_Succeeded).onCall(0).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          description: 'Backup operation in-progress'
        }));
        directorOperationStub.returns(Promise.resolve({
          state: CONST.OPERATION.SUCCEEDED,
          description: 'Backup operation Succeded'
        }));
      });
      beforeEach(function () {
        directorConfigStub.lock_deployment_max_duration = 0;
        failUnlock = false;
        FabrikStatusPoller.stopPoller = false;
      });
      afterEach(function () {
        FabrikStatusPoller.stopPoller = true;
        FabrikStatusPoller.clearAllPollers();
        directorOperationStub.reset();
        serviceFabrikClientStub.reset();
        serviceFabrikOperationStub.reset();
        getDirectorConfigStub.reset();
      });

      after(function () {
        sandbox.restore();
      });

      it('Abort backup if operation is not complete & wait for abort to complete', function () {
        return FabrikStatusPoller.start(instanceInfo_InProgress, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() =>
          Promise.delay(20).then(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(serviceFabrikOperationStub).not.to.be.called;
          }));
      });
      it('Abort backup if operation is not complete & post abort time out, unlock deployment', function () {
        config.backup.abort_time_out = 0;
        return FabrikStatusPoller.start(instanceInfo_InProgress, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() =>
          Promise.delay(30).then(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(serviceFabrikOperationStub).to.be.calledOnce;
            config.backup.abort_time_out = 180000;
          }));
      });
      it('Abort backup if operation is not complete & post successful abort, unlock deployment', function () {
        return FabrikStatusPoller.start(instanceInfo_aborting, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() =>
          Promise.delay(50).then(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(serviceFabrikOperationStub).to.be.called;
          }));
      });
      it('Stop polling operation on backup completion &  unlock deployment', function () {
        return FabrikStatusPoller.start(instanceInfo_Succeeded, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() =>
          Promise.delay(50).then(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(FabrikStatusPoller.pollers.length).to.eql(0);
            expect(serviceFabrikOperationStub).to.be.called;
          }));
      });
      it('Unlock failure must continue the poller', function () {
        failUnlock = true;
        directorConfigStub.lock_deployment_max_duration = 3000;
        return FabrikStatusPoller.start(instanceInfo_Succeeded, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() =>
          Promise.delay(50).then(() => {
            expect(directorOperationStub).to.be.calledTwice; //On recieving success response the response is set in instanceInfo
            expect(serviceFabrikClientStub).not.to.be.called;
            expect(serviceFabrikOperationStub.callCount >= 2).to.eql(true); //Retry for each invocation results in 3 calls. So expect atleast 6 (2 *3) calls
          }));
      });
    });

    describe('#PollerRestartOnBrokerRestart', function () {
      let getDeploymentNameFromCacheStub, deploymentFoundInCache;
      let deployments = [];
      deployments.push(mocks.director.deploymentNameByIndex(1));
      deployments.push(mocks.director.deploymentNameByIndex(2));
      before(function () {
        startStub = sinon.stub(FabrikStatusPoller, 'start');
        restartSpy = sinon.spy(FabrikStatusPoller, 'restart');
        getDeploymentNameFromCacheStub = sinon.stub(BoshDirectorClient.prototype, 'getDeploymentNamesFromCache', () => Promise.try(() => {
          logger.info('Deployments found in cache:', deploymentFoundInCache);
          if (deploymentFoundInCache) {
            return deployments;
          }
          throw errors.Timeout.toManyAttempts(CONST.BOSH_POLL_MAX_ATTEMPTS, new Error('Fetching deployments from Cache is taking too long.'));
        }));
      });
      beforeEach(function () {
        deploymentFoundInCache = true;
        FabrikStatusPoller.stopPoller = false;
      });
      afterEach(function () {
        FabrikStatusPoller.stopPoller = true;
        FabrikStatusPoller.clearAllPollers();
        startStub.reset();
        getDeploymentNameFromCacheStub.reset();
        restartSpy.reset();
        mocks.reset();
      });
      after(function () {
        getDeploymentNameFromCacheStub.restore();
        startStub.restore();
      });
      describe('#startIfNotLocked', function () {
        it('It should call start() if deployment is  locked', function () {
          FabrikStatusPoller.startIfNotLocked({
            username: 'admin',
            lockedForOperation: 'backup',
            createdAt: new Date(),
            instanceInfo: instanceInfo
          }, {});
          return expect(startStub).to.be.calledOnce;
        });
        it('It should not call start() if deployment is not locked', function () {
          FabrikStatusPoller.startIfNotLocked(false, {});
          return expect(startStub).not.to.be.called;
        });
      });
      describe('#restart', function () {
        it('should restart polling for deployments with lock', function () {
          _.each(
            deployments, name =>
            mocks.director.getLockProperty(name, true, {
              username: 'admin',
              lockedForOperation: 'backup',
              createdAt: new Date(),
              instanceInfo: instanceInfo
            }));
          return FabrikStatusPoller
            .restart('backup')
            .then(promises => Promise.all(promises)
              .then(() => expect(startStub).to.be.calledTwice));
        });
        it('should not restart polling for deployments without a lock', function () {
          const queued = false;
          const capacity = 2;
          const opts = {
            queued: queued,
            capacity: capacity
          };
          _.each(
            deployments, name =>
            mocks.director.getLockProperty(name, false));
          mocks.director.getDeployments(opts);
          return FabrikStatusPoller
            .restart('backup')
            .then(promises => Promise.all(promises)
              .then(() => expect(startStub).not.to.be.called));
        });
        it('If bosh is not responding at start then FabrikPoller must keep on retrying', function () {
          deploymentFoundInCache = false;
          return FabrikStatusPoller
            .restart('backup')
            .then(promises => {
              expect(startStub).not.to.be.called;
              expect(restartSpy).to.be.calledTwice;
              expect(promises).to.eql(null);
            });
        });
      });
    });
  });
});