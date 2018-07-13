'use strict';

const _ = require('lodash');
const lib = require('../../../broker/lib');
const Promise = require('bluebird');
const app = require('../support/apps').internal;
const config = lib.config;
const catalog = lib.models.catalog;
const fabrik = lib.fabrik;
const iaas = require('../../../data-access-layer/iaas');
const backupStore = iaas.backupStore;
const ScheduleManager = require('../../../broker/lib/jobs');
const DirectorManager = lib.fabrik.DirectorManager;
const cloudController = require('../../../broker/lib/cf').cloudController;

describe('service-broker-api', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/cf/v2';
      const index = mocks.director.networkSegmentIndex;
      const api_version = '2.12';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const service_plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';
      const plan = catalog.getPlan(plan_id);
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = mocks.director.uuidByIndex(index);
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const parameters = {
        foo: 'bar'
      };
      const accepts_incomplete = true;
      const container = backupStore.containerName;
      const deferred = Promise.defer();
      Promise.onPossiblyUnhandledRejection(() => {});
      let getScheduleStub;

      before(function () {
        backupStore.cloudProvider = new iaas.CloudProviderClient(config.backup.provider);
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
        it('returns 422 Unprocessable Entity when accepts_incomplete undefined', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 422 Unprocessable Entity when accepts_incomplete not true', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=false`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              expect(res.body.error).to.be.eql('AsyncRequired');
              expect(res.body.description).to.be.eql('This request requires client support for asynchronous service operations.');
            });
        });

        it('returns 400 BadRequest when space_guid missing', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              organization_guid: organization_guid,
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body.error).to.be.eql('Bad Request');
              expect(res.body.description).to.be.eql('This request is missing mandatory organization guid and/or space guid.');
            });
        });

        it('returns 400 BadRequest when organization_guid missing', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              space_guid: space_guid,
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body.error).to.be.eql('Bad Request');
              expect(res.body.description).to.be.eql('This request is missing mandatory organization guid and/or space guid.');
            });
        });

        it('returns 400 BadRequest when both organization_guid and space_guid missing', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry',
                organization_guid: organization_guid,
                space_guid: space_guid
              },
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body.error).to.be.eql('Bad Request');
              expect(res.body.description).to.be.eql('This request is missing mandatory organization guid and/or space guid.');
            });
        });

        it('returns 400 BadRequest when both organization_guid and space_guid missing: for K8S', function () {
          return chai.request(app)
            .put(`${base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
            .set('X-Broker-API-Version', api_version)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'kubernetes',
                namespace: 'default'
              },
              parameters: parameters,
              accepts_incomplete: accepts_incomplete
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body.error).to.be.eql('Bad Request');
              expect(res.body.description).to.be.eql('This request is missing mandatory organization guid and/or space guid.');
            });
        });

      });

      describe('#getInfo', function () {

        let sandbox, getDeploymentInfoStub, getServiceInstanceStub, getServicePlanStub;

        before(function () {
          sandbox = sinon.sandbox.create();
          getDeploymentInfoStub = sandbox.stub(DirectorManager.prototype, 'getDeploymentInfo');
          getServiceInstanceStub = sandbox.stub(cloudController, 'getServiceInstance');
          getServicePlanStub = sandbox.stub(cloudController, 'getServicePlan');

          let entity = {};
          getServiceInstanceStub
            .withArgs(instance_id)
            .returns(Promise.try(() => {
              return {
                metadata: {
                  guid: instance_id
                },
                entity: _.assign({
                  name: 'blueprint',
                  service_plan_guid: '466c5078-df6e-427d-8fb2-c76af50c0f56'
                }, entity)
              };
            }));

          getDeploymentInfoStub
            .withArgs(deployment_name)
            .returns(Promise.try(() => {
              return {};
            }));

          entity = {};
          getServicePlanStub
            .withArgs(service_plan_guid, {})
            .returns(Promise.try(() => {
              return {
                entity: _.assign({
                  unique_id: plan_id,
                  name: 'blueprint'
                }, entity)
              };
            }));

        });

        after(function () {
          sandbox.restore();
        });

        it('should return object with correct plan and service information', function () {
          let context = {
            platform: 'cloudfoundry'
          };
          return fabrik
            .createInstance(instance_id, service_id, plan_id, context)
            .then(instance => instance.getInfo())
            .catch(err => err.response)
            .then(res => {
              expect(res.title).to.equal('Blueprint Dashboard');
              expect(res.plan.id).to.equal(plan_id);
              expect(res.service.id).to.equal(service_id);
              expect(res.instance.metadata.guid).to.equal(instance_id);
            });
        });
      });
    });
  });
});