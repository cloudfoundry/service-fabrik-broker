'use strict';

const _ = require('lodash');
const lib = require('../../lib');
const errors = require('../../lib/errors');
const Promise = require('bluebird');
const app = require('../support/apps').internal;
const utils = lib.utils;
const config = lib.config;
const catalog = lib.models.catalog;
const fabrik = lib.fabrik;
const backupStore = lib.iaas.backupStore;
const ScheduleManager = require('../../lib/jobs');
const CONST = require('../../lib/constants');

describe('service-broker-api', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/cf/v2';
      const index = mocks.director.networkSegmentIndex;
      const api_version = '2.9';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan = catalog.getPlan(plan_id);
      const plan_id_deprecated = 'b91d9512-b5c9-4c4a-922a-fa54ae67d235';
      const plan_id_update = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = mocks.director.uuidByIndex(index);
      const instance_id_new = mocks.director.uuidByIndex(30);
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const task_id = 4711;
      const parameters = {
        foo: 'bar'
      };
      const accepts_incomplete = true;
      const protocol = config.external.protocol;
      const host = config.external.host;
      const dashboard_url = `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id}`;
      const dashboard_url_new = `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id_new}`;
      const container = backupStore.containerName;
      const deferred = Promise.defer();
      Promise.onPossiblyUnhandledRejection(() => {});
      let getScheduleStub;

      before(function () {
        backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        _.unset(fabrik.DirectorManager, plan_id);
        getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule');
        getScheduleStub.withArgs().returns(deferred.promise);
        plan.service.subnet = null;
        return mocks.setup([
          fabrik.DirectorManager.load(plan),
          backupStore.cloudProvider.getContainer()
        ]);
      });

      afterEach(function () {
        mocks.reset();
        getScheduleStub.reset();
      });

      after(function () {
        getScheduleStub.restore();
      });

      describe('#provision', function () {
        it('returns 202 Accepted', function () {
          mocks.director.getDeployments({
            queued: true
          });
          mocks.director.createOrUpdateDeployment(task_id);
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url).to.equal(dashboard_url);
              expect(res.body).to.have.property('operation');
              const decoded = utils.decodeBase64(res.body.operation);
              expect(_.pick(decoded, ['type', 'parameters', 'space_guid'])).to.eql({
                type: 'create',
                parameters: parameters,
                space_guid: space_guid
              });
              expect(decoded.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 Accepted when invoked with bosh name', function () {
          mocks.director.getDeployments({
            queued: true
          });
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.uaa.getAccessToken();
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id_new}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: {
                bosh_director_name: 'bosh',
                username: 'admin',
                password: 'admin'
              },
              accepts_incomplete: accepts_incomplete
            })
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body.dashboard_url).to.equal(dashboard_url_new);
              expect(res.body).to.have.property('operation');
              const decoded = utils.decodeBase64(res.body.operation);
              expect(_.pick(decoded, ['type', 'parameters', 'space_guid'])).to.eql({
                type: 'create',
                parameters: {
                  bosh_director_name: 'bosh',
                  username: 'admin',
                  password: 'admin'
                },
                space_guid: space_guid
              });
              mocks.verify();
            });
        });
        it('returns 403 for deprecated plan', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id_deprecated,
              organization_guid: organization_guid,
              space_guid: space_guid,
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
            });
        });
      });

      describe('#update', function () {
        it('returns 202 Accepted', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          mocks.director.getDeployment(deploymentName, true, undefined);
          mocks.director.verifyDeploymentLockStatus();
          mocks.director.createOrUpdateDeployment(task_id);
          return chai.request(app)
            .patch(`${base_url}/service_instances/${instance_id}`)
            .send({
              service_id: service_id,
              plan_id: plan_id_update,
              parameters: parameters,
              previous_values: {
                plan_id: plan_id,
                service_id: service_id,
                organization_id: organization_guid,
                space_id: space_guid
              },
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('operation');
              expect(utils.decodeBase64(res.body.operation)).to.eql({
                task_id: `${deployment_name}_${task_id}`,
                type: 'update',
                parameters: parameters
              });
              mocks.verify();
            });
        });
      });

      describe('#deprovision', function () {
        it('returns 202 Accepted', function () {
          const restoreFilename = `${space_guid}/restore/${service_id}.${instance_id}.json`;
          const restorePathname = `/${container}/${restoreFilename}`;

          mocks.director.getDeploymentVms(deployment_name);
          mocks.agent.getInfo(2);
          mocks.agent.deprovision();
          mocks.director.verifyDeploymentLockStatus();
          mocks.cloudController.findSecurityGroupByName(instance_id);
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid
          });
          mocks.cloudController.deleteSecurityGroup(instance_id);
          mocks.director.deleteDeployment(task_id);
          mocks.cloudProvider.remove(restorePathname);
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              accepts_incomplete: accepts_incomplete
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('operation');
              expect(utils.decodeBase64(res.body.operation)).to.eql({
                task_id: `${deployment_name}_${task_id}`,
                type: 'delete',
              });
              //expect(cancelScheduleStub).to.be.calledOnce;
              //expect(cancelScheduleStub.firstCall.args[0]).to.eql(instance_id);
              //expect(cancelScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
              mocks.verify();
            });
        });
      });

      describe('#lastOperation', function () {
        it('returns 200 OK (state = in progress)', function () {
          mocks.director.getDeploymentTask(task_id, 'processing');
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: utils.encodeBase64({
                task_id: `${deployment_name}_${task_id}`,
                type: 'create',
                space_guid: space_guid
              })
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Create deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });

        it('returns 200 OK (state = succeeded)', function () {
          mocks.director.getDeploymentTask(task_id, 'done');
          mocks.cloudController.createSecurityGroup(instance_id);
          const payload = {
            repeatInterval: CONST.SCHEDULE.RANDOM,
            timeZone: 'Asia/Kolkata'
          };
          mocks.serviceFabrikClient.scheduleUpdate(instance_id, payload);
          const randomIntStub = sinon.stub(utils, 'getRandomInt', () => 1);
          const old = config.scheduler.jobs.service_instance_update.run_every_xdays;
          config.scheduler.jobs.service_instance_update.run_every_xdays = 15;
          config.mongodb.provision.plan_id = 'TEST';
          return chai.request(app)
            .get(`${base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: utils.encodeBase64({
                task_id: `${deployment_name}_${task_id}`,
                type: 'create',
                space_guid: space_guid
              })
            })
            .catch(err => err.response)
            .then(res => {
              delete config.mongodb.provision.plan_id;
              randomIntStub.restore();
              config.scheduler.jobs.service_instance_update.run_every_xdays = old;
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });
      });

      describe('#bind', function () {
        it('returns 201 Created', function (done) {
          config.mongodb.provision.plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
          deferred.reject(new errors.NotFound('Schedule not found'));
          const WAIT_TIME_FOR_ASYNCH_SCHEDULE_OPERATION = 0;
          mocks.director.getDeploymentVms(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.createCredentials();
          mocks.director.createBindingProperty(binding_id);
          mocks.serviceFabrikClient.scheduleBackup(instance_id, {
            type: CONST.BACKUP.TYPE.ONLINE,
            repeatInterval: 'daily'
          });
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              app_guid: app_guid,
              bind_resource: {
                app_guid: app_guid
              }
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                credentials: mocks.agent.credentials
              });
              setTimeout(() => {
                delete config.mongodb.provision.plan_id;
                expect(getScheduleStub).to.be.calledOnce;
                expect(getScheduleStub.firstCall.args[0]).to.eql(instance_id);
                expect(getScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
                mocks.verify();
                done();
                //Schedule operation is performed in background after response has been returned,
                //hence added this delay of 500 ms which should work in all cases.
                //In case asserts are failing, try increasing the timeout first & then debug. :-)
              }, WAIT_TIME_FOR_ASYNCH_SCHEDULE_OPERATION);
            });
        });
      });

      describe('#unbind', function () {
        it('returns 200 OK', function () {
          mocks.director.getDeploymentVms(deployment_name);
          mocks.director.getBindingProperty(binding_id);
          mocks.agent.getInfo();
          mocks.agent.deleteCredentials();
          mocks.director.deleteBindingProperty(binding_id);
          return chai.request(app)
            .delete(`${base_url}/service_instances/${instance_id}/service_bindings/${binding_id}`)
            .query({
              service_id: service_id,
              plan_id: plan_id
            })
            .set('X-Broker-API-Version', api_version)
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });
    });
  });
});