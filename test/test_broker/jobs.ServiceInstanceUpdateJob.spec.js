'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const CONST = require('../../common/constants');
const catalog = require('../../common/models/catalog');
const utils = require('../../common/utils');
const config = require('../../common/config');
const errors = require('../../common/errors');
const BaseJob = require('../../jobs/BaseJob');
const JobFabrik = require('../../jobs/JobFabrik');
const ScheduleManager = require('../../jobs/ScheduleManager');
const Repository = require('../../common/db').Repository;
const NetworkSegmentIndex = require('../../data-access-layer/bosh/NetworkSegmentIndex');

describe('Jobs', function () {
  const ServiceInstanceUpdateJob = JobFabrik.getJob(CONST.JOB.SERVICE_INSTANCE_UPDATE);
  const index = NetworkSegmentIndex.adjust(mocks.director.networkSegmentIndex);
  const instance_id = mocks.director.uuidByIndex(index);
  /* jshint expr:true */
  describe('ServiceInstanceUpdateJob', function () {
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const plan_id_forced_update = 'fc158c9a-7934-401e-94ab-057082a5073f';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    let job;
    const job_sample = {
      attrs: {
        name: CONST.JOB.SERVICE_INSTANCE_UPDATE,
        data: {
          _n_a_m_e_: `${instance_id}_${CONST.JOB.SERVICE_INSTANCE_UPDATE}`,
          instance_name: 'bp01',
          instance_id: instance_id,
          deployment_name: `${CONST.SERVICE_FABRIK_PREFIX}-${index}-${instance_id}`
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
    const resourceDetails = function (planId) {
      return {
        apiVersion: 'deployment.servicefabrik.io/v1alpha1',
        kind: 'Director',
        metadata: {
          annotations: {
            lockedByManager: '',
            lockedByTaskPoller: '{\"lockTime\":\"2018-09-06T16:38:34.919Z\",\"ip\":\"10.0.2.2\"}'
          },
          creationTimestamp: '2018-09-06T16:01:28Z',
          generation: 1,
          labels: {
            state: 'succeeded'
          },
          name: instance_id,
          namespace: 'default',
          resourceVersion: '3364',
          selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
          uid: '1d48b3f3-b1ee-11e8-ac2a-06c007f8352b'

        },
        spec: {
          options: JSON.stringify({
            service_id: service_id,
            plan_id: planId || plan_id,
            context: {
              platform: 'cloudfoundry',
              organization_guid: organization_guid,
              space_guid: space_guid
            },
            organization_guid: organization_guid,
            space_guid: space_guid
          })
        },
        status: {
          state: 'succeeded',
          lastOperation: '{}',
          response: '{}'
        }
      };
    };

    let sandbox, baseJobLogRunHistoryStub, cancelScheduleStub, scheduleRunAtStub, uuidv4Stub, catalogStub;

    before(function () {
      sandbox = sinon.sandbox.create();
      baseJobLogRunHistoryStub = sandbox.stub(BaseJob, 'logRunHistory');
      baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
      cancelScheduleStub = sandbox.stub(ScheduleManager, 'cancelSchedule', () => Promise.resolve({}));
      scheduleRunAtStub = sandbox.stub(ScheduleManager, 'runAt', () => Promise.resolve({}));
      const plan = catalog.getPlan(plan_id);
      const forcedUpdatePlan = _.cloneDeep(plan);
      forcedUpdatePlan.service.force_update = true;
      uuidv4Stub = sandbox.stub(utils, 'uuidV4');
      catalogStub = sandbox.stub(catalog, 'getPlan');
      uuidv4Stub.withArgs().returns(Promise.resolve(backup_guid));
      catalogStub.withArgs(plan_id_forced_update).returns(forcedUpdatePlan);
      catalogStub.withArgs(plan_id).returns(plan);
      return mocks.setup();
    });

    beforeEach(function () {
      job = _.cloneDeep(job_sample);
    });

    afterEach(function () {
      mocks.reset();
      baseJobLogRunHistoryStub.reset();
      cancelScheduleStub.reset();
      scheduleRunAtStub.reset();
      catalogStub.reset();
      uuidv4Stub.reset();
    });

    after(function () {
      sandbox.restore();
    });

    it('job must not start and error if mandatory params (instance_id | deployment_name) is missing', function (done) {
      const sfClientStub = sinon.stub(ServiceInstanceUpdateJob, 'getFabrikClient');
      const badJob = {
        attrs: {
          data: {}
        },
        fail: () => {},
        save: () => {}
      };
      return ServiceInstanceUpdateJob
        .run(badJob, () => {})
        .then(() => {
          const invalidInputMsg = `ServiceInstance Update cannot be initiated as the required mandatory params (instance_id | deployment_name) is empty : ${JSON.stringify(badJob.attrs.data)}`;
          expect(sfClientStub).not.to.be.called;
          sfClientStub.restore();
          const expectedResponse = {
            instance_deleted: false,
            job_cancelled: false,
            deployment_outdated: 'TBD',
            update_init: 'TBD',
            diff: 'TBD'
          };
          expect(baseJobLogRunHistoryStub.firstCall.args[0].message).to.eql(invalidInputMsg);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('BadRequest');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].reason).to.eql('Bad Request');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(400);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(badJob.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        }).catch(done);
    });
    it('job must not start and error if update feature is turned off in config', function (done) {
      const sfClientStub = sinon.stub(ServiceInstanceUpdateJob, 'getFabrikClient');
      config.feature.ServiceInstanceAutoUpdate = false;
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          config.feature.ServiceInstanceAutoUpdate = true;
          const invalidInputMsg = `Schedule update feature is turned off. Cannot run update for ${job_sample.attrs.data.instance_name} - Deployment: ${job_sample.attrs.data.deployment_name}`;
          expect(sfClientStub).not.to.be.called;
          sfClientStub.restore();
          const expectedResponse = {
            instance_deleted: false,
            job_cancelled: false,
            deployment_outdated: 'TBD',
            update_init: 'TBD',
            diff: 'TBD'
          };
          expect(baseJobLogRunHistoryStub.firstCall.args[0].message).to.eql(invalidInputMsg);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('ServiceUnavailable');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].reason).to.eql('Service Unavailable');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(503);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        }).catch(done);
    });
    it('if service instance is not found, should cancel itself', function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, 404);
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          expect(cancelScheduleStub).to.be.calledOnce;
          expect(cancelScheduleStub.firstCall.args[0]).to.eql(instance_id);
          expect(cancelScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          done();
        }).catch(done);
    });
    it('if there is no update to be done on the instance, the job just succeeds with status as no_update_required', function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, []);
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: false,
        update_init: 'NA',
        diff: []
      };
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        }).catch(done);
    });
    it(`if instance is outdated, update must initiated successfully and schedule itself ${config.scheduler.jobs.reschedule_delay}`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.SUCCEEDED,
        update_response: {},
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 202
      });
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });

    it(`if instance is outdated and job was created with run_immediately flag set, update must initiated successfully and schedule itself ${config.scheduler.jobs.reschedule_delay}`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      job.attrs.data.run_immediately = true;
      const diff = [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.SUCCEEDED,
        update_response: {},
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 202
      });
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });
    it('if instance is outdated, and changes are in forbidden section trying to increase/decrease # of instances then update must not be initiated', function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['instance_groups:', null],
        ['- name: blueprint', null],
        ['  instances: 1', 'removed'],
        ['  instances: 2', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.FAILED,
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          const invalidInputMsg = 'Automatic update not possible. Detected changes in forbidden sections:  instances: 1,removed,  instances: 2,added';
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0].message).to.eql(invalidInputMsg);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Forbidden');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].reason).to.eql('Forbidden');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(403);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });
    it('if instance is outdated, and changes are in forbidden section trying to remove a job, then update must not be initiated', function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['instance_groups:', null],
        ['- name: blueprint', null],
        ['  jobs:', null],
        ['  - name: broker-agent', 'removed'],
        ['    release: blueprint', 'removed']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.FAILED,
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          const invalidInputMsg = 'Automatic update not possible. Job definition removed:   - name: broker-agent';
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0].message).to.eql(invalidInputMsg);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Forbidden');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].reason).to.eql('Forbidden');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(403);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });
    it(`if instance is outdated with changes in forbidden section and if service force_update is set to true, then update must be initiated successfully and schedule itself ${config.scheduler.jobs.reschedule_delay}`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails(plan_id_forced_update));
      const diff = [
        ['jobs:', null],
        ['- name: blueprint_z1', null],
        ['  instances: 2', 'removed'],
        ['  instances: 1', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 202
      });
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.SUCCEEDED,
        update_response: {},
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });
    it(`if instance is outdated, update initiation attempt fails and then schedule itself ${config.scheduler.jobs.reschedule_delay}`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 500
      });
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.FAILED,
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0] instanceof errors.InternalServerError).to.eql(true);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });
    it(`if instance is outdated, update initiation attempt fails and then it must not schedule itself if max re-try attempts are exceeded`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 500
      });
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.FAILED,
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      const oldMaxAttempts = config.scheduler.jobs.service_instance_update.max_attempts;
      config.scheduler.jobs.service_instance_update.max_attempts = 1;
      job.attrs.data.attempt = 1;
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          config.scheduler.jobs.service_instance_update.max_attempts = oldMaxAttempts;
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0] instanceof errors.InternalServerError).to.eql(true);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).not.to.be.called;
          done();
        }).catch(done);
    });
    it(`if instance is outdated & if update initiation attempt fails due to a backup run then it must Schedule itself even if max re-try attempts are exceeded`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 422,
        body: {
          error: 'Unprocessable Entity',
          status: 422,
          description: `Service Instance ${job.attrs.data.instance_id} ${CONST.OPERATION_TYPE.LOCK} at Mon Sep 10 2018 11:17:01 GMT+0000 (UTC) for backup`,
        }
      });
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.FAILED,
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      const oldMaxAttempts = config.scheduler.jobs.service_instance_update.max_attempts;
      config.scheduler.jobs.service_instance_update.max_attempts = 0;
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          config.scheduler.jobs.service_instance_update.max_attempts = oldMaxAttempts;
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0] instanceof errors.UnprocessableEntity).to.eql(true);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].statusMessage).to.eql('Backup in-progress. Update cannot be initiated');
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });
    it(`if instance is outdated, update initiation attempt fails due to backup  then it must not schedule itself if update will run beyond current update window`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 500
      });
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.FAILED,
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      const oldMaxAttempts = config.scheduler.jobs.service_instance_update.max_attempts;
      config.scheduler.jobs.service_instance_update.max_attempts = 5000;
      let retryDelayInMinutes = 1;
      if ((config.scheduler.jobs.reschedule_delay.toLowerCase()).indexOf('minutes') !== -1) {
        retryDelayInMinutes = parseInt(/^[0-9]+/.exec(config.scheduler.jobs.reschedule_delay)[0]);
      }
      job.attrs.data.attempt = config.scheduler.jobs.service_instance_update.run_every_xdays * 24 * (60 / retryDelayInMinutes) + 1;
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          config.scheduler.jobs.service_instance_update.max_attempts = oldMaxAttempts;
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0] instanceof errors.InternalServerError).to.eql(true);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).not.to.be.called;
          done();
        }).catch(done);
    });
    it(`if instance is outdated & if update initiation attempt fails due to bosh rate limits exceeded then it must Schedule itself even if max re-try attempts are exceeded`, function (done) {
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resourceDetails());
      const diff = [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ];
      mocks.director.getDeploymentManifest(1);
      mocks.director.diffDeploymentManifest(1, diff);
      mocks.serviceBrokerClient.updateServiceInstance(instance_id, (body) => {
        return body.plan_id === plan_id && body.parameters.scheduled === true;
      }, {
        status: 422,
        body: {
          status: 422,
          description: `Deployment ${job.attrs.data.deployment_name} ${CONST.FABRIK_OPERATION_STAGGERED}, Reason: ${CONST.FABRIK_OPERATION_COUNT_EXCEEDED}`
        }
      });
      const expectedResponse = {
        instance_deleted: false,
        job_cancelled: false,
        deployment_outdated: true,
        update_init: CONST.OPERATION.FAILED,
        diff: utils.unifyDiffResult({
          diff: diff
        })
      };
      const oldMaxAttempts = config.scheduler.jobs.service_instance_update.max_attempts;
      config.scheduler.jobs.service_instance_update.max_attempts = 0;
      return ServiceInstanceUpdateJob
        .run(job, () => {})
        .then(() => {
          mocks.verify();
          config.scheduler.jobs.service_instance_update.max_attempts = oldMaxAttempts;
          expect(cancelScheduleStub).not.to.be.called;
          expect(baseJobLogRunHistoryStub.firstCall.args[0] instanceof errors.UnprocessableEntity).to.eql(true);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].statusMessage).to.eql('Deployment attempt rejected due to BOSH overload. Update cannot be initiated');
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          expect(scheduleRunAtStub).to.be.calledOnce;
          expect(scheduleRunAtStub.firstCall.args[0]).to.eql(job.attrs.data.instance_id);
          expect(scheduleRunAtStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
          expect(scheduleRunAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          done();
        }).catch(done);
    });
  });

  describe('#LastRunStatus', function () {
    let repositoryStub, returnResponse, failedBecauseOfBackupInProgress, onlyFirstRunComplete;
    const lastRunStatus = {
      name: instance_id,
      type: CONST.JOB.SERVICE_INSTANCE_UPDATE,
      interval: '12 12 * * *',
      data: {
        instance_id: instance_id,
        attempt: 1,
        _n_a_m_e_: `${instance_id}_${CONST.JOB.SERVICE_INSTANCE_UPDATE}`
      },
      response: {
        diff: [{
          releases: {}
        }]
      },
      statusCode: CONST.JOB_RUN_STATUS_CODE.SUCCEEDED,
      statusMessage: 'run successful',
      startedAt: new Date(),
      createdAt: new Date(),
      createdBy: 'SYSTEM',
      processedBy: 'MAC1'
    };
    before(function () {
      repositoryStub = sinon.stub(Repository, 'search', () => {
        return Promise.try(() => {
          if (returnResponse === CONST.OPERATION.FAILED) {
            let resp = [];
            for (let x = 0; x < 3; x++) {
              const runStatus = _.cloneDeep(lastRunStatus);
              runStatus.statusCode = failedBecauseOfBackupInProgress ? CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY :
                CONST.HTTP_STATUS_CODE.CONFLICT;
              runStatus.statusMessage = 'run failed';
              runStatus.data.attempt = x + 1;
              resp.push(runStatus);
            }
            return {
              list: resp,
              totalRecordCount: 2,
              nextOffset: -1
            };
          } else if (returnResponse === CONST.OPERATION.IN_PROGRESS) {
            const runStatus = _.cloneDeep(lastRunStatus);
            runStatus.statusCode = CONST.HTTP_STATUS_CODE.CONFLICT;
            runStatus.data.attempt = 2;
            return {
              list: [runStatus, lastRunStatus],
              totalRecordCount: 2,
              nextOffset: -1
            };
          } else if (returnResponse === CONST.OPERATION.SUCCEEDED) {
            const runStatus = _.cloneDeep(lastRunStatus);
            runStatus.response.diff = [];
            runStatus.data.attempt = 2;
            return {
              list: onlyFirstRunComplete ? [lastRunStatus] : [runStatus, lastRunStatus],
              totalRecordCount: 2,
              nextOffset: -1
            };
          } else {
            return {
              list: null,
              totalRecordCount: 0,
              nextOffset: -1
            };
          }
        });
      });
    });
    after(function () {
      repositoryStub.restore();
    });
    it(`Returns successful last run status`, function () {
      returnResponse = CONST.OPERATION.SUCCEEDED;
      return ServiceInstanceUpdateJob.getLastRunStatus(instance_id)
        .then(runstatus => {
          expect(runstatus.status).to.be.equal(CONST.OPERATION.SUCCEEDED);
          expect(runstatus.diff.before).to.eql(lastRunStatus.response.diff);
          expect(runstatus.diff.after).to.eql([]);
        });
    });
    it(`Returns null last run status when job run details are not found`, function () {
      returnResponse = undefined;
      return ServiceInstanceUpdateJob.getLastRunStatus(instance_id)
        .then(runstatus => {
          expect(runstatus).to.be.equal(null);
        });
    });
    it(`Returns failed last run status with user initiate updae in-progress scenario`, function () {
      returnResponse = CONST.OPERATION.FAILED;
      failedBecauseOfBackupInProgress = false;
      return ServiceInstanceUpdateJob.getLastRunStatus(instance_id)
        .then(runstatus => {
          expect(runstatus.status).to.be.equal(CONST.OPERATION.FAILED);
          expect(runstatus.message).to.be.equal(`${CONST.HTTP_STATUS_CODE.CONFLICT} - run failed`);
          expect(runstatus.diff.before).to.eql(lastRunStatus.response.diff);
          expect(runstatus.diff.after).to.eql(lastRunStatus.response.diff);
        });
    });
    it(`Returns failed last run status with backup in-progress scenario`, function () {
      returnResponse = CONST.OPERATION.FAILED;
      failedBecauseOfBackupInProgress = true;
      return ServiceInstanceUpdateJob.getLastRunStatus(instance_id)
        .then(runstatus => {
          expect(runstatus.status).to.be.equal(CONST.OPERATION.FAILED);
          expect(runstatus.message).to.be.equal('Could not initiate update as Backup process was in-progress');
          expect(runstatus.diff.before).to.eql(lastRunStatus.response.diff);
          expect(runstatus.diff.after).to.eql(lastRunStatus.response.diff);
        });
    });
    it(`Returns last run status as succeeded but diff after is returned as in-progress`, function () {
      returnResponse = CONST.OPERATION.SUCCEEDED;
      onlyFirstRunComplete = true;
      const updateInProgressMsg = 'TBD';
      return ServiceInstanceUpdateJob.getLastRunStatus(instance_id)
        .then(runstatus => {
          onlyFirstRunComplete = false;
          expect(runstatus.status).to.be.equal(CONST.OPERATION.SUCCEEDED);
          expect(runstatus.diff.before).to.eql(lastRunStatus.response.diff);
          expect(runstatus.diff.after).to.eql(updateInProgressMsg);
        });
    });
    it(`Returns in-progress last run status`, function () {
      returnResponse = CONST.OPERATION.IN_PROGRESS;
      return ServiceInstanceUpdateJob.getLastRunStatus(instance_id)
        .then(runstatus => {
          expect(runstatus.status).to.be.equal(CONST.OPERATION.IN_PROGRESS);
          expect(runstatus.diff.before).to.eql(lastRunStatus.response.diff);
          expect(runstatus.diff.after).to.eql(lastRunStatus.response.diff);
        });
    });
  });

  describe('#Random', function () {
    let randomIntStub, randomize, randomInt;
    before(function () {
      randomInt = utils.getRandomInt;
      randomIntStub = sinon.stub(utils, 'getRandomInt', (min, max) => (randomize ? randomInt(min, max) : 1));
    });
    after(function () {
      randomIntStub.restore();
    });
    it(`Returns random schedule interval for the service instance update Job`, function () {
      const oldRun = config.scheduler.jobs.service_instance_update.run_every_xdays;
      config.scheduler.jobs.service_instance_update.run_every_xdays = 7;
      const repeatInterval = ServiceInstanceUpdateJob.getRandomRepeatInterval();
      expect(repeatInterval).to.equal('1 1 1,8,15,22 * *');
      config.scheduler.jobs.service_instance_update.run_every_xdays = oldRun;
    });
    it(`Returns random schedule between the defined start end times`, function () {
      randomize = true;
      const oldConfig = _.clone(config.scheduler.jobs.service_instance_update);
      config.scheduler.jobs.service_instance_update.run_every_xdays = 7;
      config.scheduler.jobs.service_instance_update.should_start_after_hr = 10;
      config.scheduler.jobs.service_instance_update.should_start_before_hr = 12;
      config.scheduler.jobs.service_instance_update.should_start_after_min = 35;
      config.scheduler.jobs.service_instance_update.should_start_before_min = 40;
      const repeatInterval = ServiceInstanceUpdateJob.getRandomRepeatInterval();
      const repeatArr = repeatInterval.split(' ');
      expect(repeatArr[0] >= config.scheduler.jobs.service_instance_update.should_start_after_min).to.equal(true);
      expect(repeatArr[0] <= config.scheduler.jobs.service_instance_update.should_start_before_min).to.equal(true);
      expect(repeatArr[1] >= config.scheduler.jobs.service_instance_update.should_start_after_hr).to.equal(true);
      expect(repeatArr[1] <= config.scheduler.jobs.service_instance_update.should_start_before_hr).to.equal(true);
      config.scheduler.jobs.service_instance_update = oldConfig;
    });
  });
});