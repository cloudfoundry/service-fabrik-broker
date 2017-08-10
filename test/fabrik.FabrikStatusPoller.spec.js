'use strict';

const lib = require('../lib');
const _ = require('lodash');
const proxyquire = require('proxyquire');
const DirectorManager = lib.fabrik.DirectorManager;
const CONST = require('../lib/constants');
const ServiceFabrikClient = require('../lib/cf/ServiceFabrikClient');
const ServiceFabrikOperation = require('../lib/fabrik/ServiceFabrikOperation');

describe('fabrik', function () {
  describe('FabrikStatusPoller', function () {
    /* jshint expr:true */

    let sandbox, startStub, directorOperationStub, serviceFabrikClientStub, serviceFabrikOperationStub;
    const index = mocks.director.networkSegmentIndex;
    const time = Date.now();
    const IN_PROGRESS_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const SUCCEEDED_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180bs';
    const ABORTING_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180ba';
    const instanceInfo = {
      space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
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

    const config = {
      director: {
        lock_deployment_max_duration: 10000
      },
      backup: {
        status_check_every: 100,
        abort_time_out: 180000
      }
    };

    const FabrikStatusPoller = proxyquire('../lib/fabrik/FabrikStatusPoller', {
      '../config': config
    });

    describe('#PollOperation', function () {
      before(function () {
        sandbox = sinon.sandbox.create();
        directorOperationStub = sandbox.stub(DirectorManager.prototype, 'getServiceFabrikOperationState');
        serviceFabrikClientStub = sandbox.stub(ServiceFabrikClient.prototype, 'abortLastBackup');
        serviceFabrikOperationStub = sandbox.stub(ServiceFabrikOperation.prototype, 'invoke');
        directorOperationStub.withArgs('backup', instanceInfo_InProgress).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS
        }));
        directorOperationStub.withArgs('backup', instanceInfo_aborting).onCall(0).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTING
        }));
        directorOperationStub.withArgs('backup', instanceInfo_aborting).onCall(1).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTED
        }));
        directorOperationStub.withArgs('backup', instanceInfo_Succeeded).onCall(0).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS
        }));
        directorOperationStub.withArgs('backup', instanceInfo_Succeeded).onCall(1).returns(Promise.resolve({
          state: CONST.OPERATION.SUCCEEDED
        }));
      });

      afterEach(function () {
        directorOperationStub.reset();
        serviceFabrikClientStub.reset();
        serviceFabrikOperationStub.reset();
      });

      after(function () {
        sandbox.restore();
      });

      it('Abort backup if operation is not complete & wait for abort to complete', function (done) {
        config.director.lock_deployment_max_duration = 0;
        FabrikStatusPoller.start(instanceInfo_InProgress, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() => {
          setTimeout(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(serviceFabrikOperationStub).not.to.be.called;
            config.director.lock_deployment_max_duration = 10000;
            done();
          }, 200);
        });
      });
      it('Abort backup if operation is not complete & post abort time out, unlock deployment', function (done) {
        config.director.lock_deployment_max_duration = 0;
        config.backup.abort_time_out = 0;
        FabrikStatusPoller.start(instanceInfo_InProgress, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() => {
          setTimeout(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(serviceFabrikOperationStub).to.be.calledOnce;
            config.backup.abort_time_out = 180000;
            config.director.lock_deployment_max_duration = 10000;
            done();
          }, 200);
        });
      });
      it('Abort backup if operation is not complete & post successful abort, unlock deployment', function (done) {
        config.director.lock_deployment_max_duration = 0;
        FabrikStatusPoller.start(instanceInfo_aborting, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() => {
          setTimeout(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(serviceFabrikOperationStub).to.be.called;
            done();
          }, 300);
        });
      });
      it('Stop polling operation on backup completion &  unlock deployment', function (done) {
        config.director.lock_deployment_max_duration = 0;
        FabrikStatusPoller.start(instanceInfo_Succeeded, CONST.OPERATION_TYPE.BACKUP, {
          name: 'hugo',
          email: 'hugo@sap.com'
        }).then(() => {
          setTimeout(() => {
            expect(directorOperationStub).to.be.atleastOnce;
            expect(serviceFabrikClientStub).to.be.calledOnce;
            expect(serviceFabrikOperationStub).to.be.called;
            done();
          }, 300);
        });
      });
    });

    describe('#PollerRestartOnBrokerRestart', function () {

      before(function () {
        startStub = sandbox.stub(FabrikStatusPoller, 'start');
      });

      afterEach(function () {
        startStub.reset();
        mocks.reset();
      });

      after(function () {
        startStub.restore();
      });


      describe('#startIfNotLocked', function () {
        it('It should call start() if deployment is  locked', function () {
          FabrikStatusPoller.startIfNotLocked(true, {});
          return expect(startStub).to.be.calledOnce;
        });
        it('It should not call start() if deployment is not locked', function () {
          FabrikStatusPoller.startIfNotLocked(false, {});
          return expect(startStub).not.to.be.called;
        });
      });

      describe('#restart', function () {
        it('should restart polling for deployments with lock', function () {
          const queued = false;
          const capacity = 2;
          const opts = {
            queued: queued,
            capacity: capacity
          };
          _.each(
            mocks.director.getDeploymentNames(capacity, queued), deploymentObj =>
            mocks.director.getLockProperty(deploymentObj.name, true));
          mocks.director.getDeployments(opts);
          FabrikStatusPoller
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
            mocks.director.getDeploymentNames(capacity, queued), deploymentObj =>
            mocks.director.getLockProperty(deploymentObj.name, false));
          mocks.director.getDeployments(opts);
          FabrikStatusPoller
            .restart('backup')
            .then(promises => Promise.all(promises)
              .then(() => expect(startStub).not.to.be.called));
        });
      });
    });
  });
});