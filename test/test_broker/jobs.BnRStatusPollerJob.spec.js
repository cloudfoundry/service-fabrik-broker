// 'use strict';

// const _ = require('lodash');
// const CONST = require('../../common/constants');
// const proxyquire = require('proxyquire');
// const logger = require('../../common/logger');
// const BaseJob = require('../../jobs/BaseJob');
// const ScheduleManager = require('../../jobs/ScheduleManager');
// const ServiceFabrikOperation = require('../../broker/lib/fabrik/ServiceFabrikOperation');
// const errors = require('../../common/errors');
// // const lib = require('../../broker/lib');
// // const DirectorManager = lib.fabrik.DirectorManager;
// const BoshDirectorClient = require('../../data-access-layer/bosh').BoshDirectorClient;

// describe('Jobs', function () {
//   /* jshint expr:true */
//   describe('BnRStatusPollerJob', function () {
//     /* jshint expr:true */
//     const index = mocks.director.networkSegmentIndex;
//     const time = Date.now();
//     const IN_PROGRESS_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180be';
//     const SUCCEEDED_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180bs';
//     const ABORTING_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180ba';
//     const UNLOCK_FAILED_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180bc';
//     let instanceInfo = {
//       tenant_id: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
//       instance_guid: mocks.director.uuidByIndex(index),
//       agent_ip: '10.10.0.15',
//       service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
//       plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
//       deployment: mocks.director.deploymentNameByIndex(index),
//       started_at: time
//     };
//     const deploymentName = instanceInfo.deployment;
//     const directorConfigStub = {
//       lock_deployment_max_duration: 30000
//     };
//     const config = {
//       enable_service_fabrik_v2: false,
//       backup: {
//         status_check_every: 10,
//         abort_time_out: 180000,
//         retry_delay_on_error: 10,
//         lock_check_delay_on_restart: 0
//       }
//     };
//     const BnRStatusPollerJob = proxyquire('../../jobs/BnRStatusPollerJob', {
//       '../common/config': config
//     });
//     const instanceInfo_InProgress = _.clone(instanceInfo);
//     _.set(instanceInfo_InProgress, 'backup_guid', IN_PROGRESS_BACKUP_GUID);
//     const instanceInfo_Succeeded = _.clone(instanceInfo);
//     _.set(instanceInfo_Succeeded, 'backup_guid', SUCCEEDED_BACKUP_GUID);
//     const instanceInfo_aborting = _.clone(instanceInfo);
//     _.set(instanceInfo_aborting, 'backup_guid', ABORTING_BACKUP_GUID);
//     const instanceInfo_unlock_failed = _.clone(instanceInfo);
//     _.set(instanceInfo_unlock_failed, 'backup_guid', UNLOCK_FAILED_BACKUP_GUID);

//     function getJobBasedOnOperation(operationName, add_instanceInfo) {
//       const job = {
//         attrs: {
//           name: `${deploymentName}_${operationName}_${add_instanceInfo.backup_guid}_${CONST.JOB.BNR_STATUS_POLLER}`,
//           data: {
//             _n_a_m_e_: `${deploymentName}_${operationName}_${add_instanceInfo.backup_guid}_${CONST.JOB.BNR_STATUS_POLLER}`,
//             type: CONST.BACKUP.TYPE.ONLINE,
//             trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
//             operation: operationName,
//             operation_details: _.assign(instanceInfo, add_instanceInfo)
//           },
//           lastRunAt: new Date(),
//           nextRunAt: new Date(),
//           repeatInterval: '*/1 * * * *',
//           lockedAt: null,
//           repeatTimezone: 'America/New_York'
//         },
//         fail: () => undefined,
//         save: () => undefined,
//         touch: () => undefined
//       };
//       return job;
//     }

//     let sandbox, serviceFabrikOperationStub,
//       getDirectorConfigStub, failUnlock, baseJobLogRunHistoryStub, scheduleJobStub, cancelScheduleStub;
//     before(function () {
//       sandbox = sinon.sandbox.create();
//       cancelScheduleStub = sinon.stub(ScheduleManager, 'cancelSchedule', () => Promise.resolve({}));
//       scheduleJobStub = sinon.stub(ScheduleManager, 'schedule', () => Promise.resolve({}));
//       baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
//       baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));

//       serviceFabrikOperationStub = sandbox.stub(ServiceFabrikOperation.prototype, 'invoke', () => Promise.try(() => {
//         logger.warn('Unlock must fail:', failUnlock);
//         if (failUnlock) {
//           throw new errors.InternalServerError('Simulated expected test error...');
//         }
//         return {};
//       }));
//       getDirectorConfigStub = sandbox.stub(BoshDirectorClient.prototype, 'getDirectorConfig');
//       getDirectorConfigStub.withArgs(instanceInfo.deployment).returns(directorConfigStub);
//     });

//     beforeEach(function () {
//       directorConfigStub.lock_deployment_max_duration = 0;
//       failUnlock = false;
//     });

//     afterEach(function () {
//       cancelScheduleStub.reset();
//       scheduleJobStub.reset();
//       baseJobLogRunHistoryStub.reset();
//       serviceFabrikOperationStub.reset();
//       getDirectorConfigStub.reset();
//     });

//     after(function () {
//       cancelScheduleStub.restore();
//       scheduleJobStub.restore();
//       baseJobLogRunHistoryStub.restore();
//       sandbox.restore();
//     });

//     describe('#CheckBackupStatus', function () {

//       it('status check failed - mandatory input not provided', function () {
//         const job = getJobBasedOnOperation('backup', {
//           backup_guid: undefined,
//         });
//         return BnRStatusPollerJob.run(job, () => {
//           expect(cancelScheduleStub).not.to.be.called;
//           expect(scheduleJobStub).not.to.be.called;
//           expect(baseJobLogRunHistoryStub).to.be.calledOnce;
//           expect(baseJobLogRunHistoryStub.firstCall.args[0]).not.to.eql(undefined);
//           expect(baseJobLogRunHistoryStub.firstCall.args[0].message.search(/BnR status poller cannot be initiated as the required mandatory params/i) === 0).to.eql(true);
//           expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('BadRequest');
//           expect(baseJobLogRunHistoryStub.firstCall.args[0].reason).to.eql('Bad Request');
//           expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(400);
//           expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql({});
//           expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
//           expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
//         });
//       });

//       it('status check failed - operation name not backup', function () {
//         const job = getJobBasedOnOperation('random_operation', {
//           backup_guid: SUCCEEDED_BACKUP_GUID,
//         });
//         return BnRStatusPollerJob.run(job, () => {
//           expect(cancelScheduleStub).not.to.be.called;
//           expect(scheduleJobStub).not.to.be.called;
//           expect(baseJobLogRunHistoryStub).to.be.calledOnce;
//           expect(baseJobLogRunHistoryStub.firstCall.args[0]).not.to.eql(undefined);
//           expect(baseJobLogRunHistoryStub.firstCall.args[0].statusCode).to.eql('ERR_RANDOM_OPERATION_NOT_SUPPORTED');
//           expect(baseJobLogRunHistoryStub.firstCall.args[0].statusMessage).to.eql('Operation polling not supported for operation - random_operation');
//           expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql({});
//           expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
//           expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
//         });
//       });

//       it('calling BnRStatusPollerJob constructor', function (done) {
//         let BnRStatusPollerJobClass = require('../../jobs/BnRStatusPollerJob');
//         let bnRStatusPollerJobObj = new BnRStatusPollerJobClass();
//         return Promise.try(() => {
//             expect(bnRStatusPollerJobObj instanceof BnRStatusPollerJobClass).to.be.eql(true);
//           })
//           .then(() => done());
//       });
//     });
//   });
// });