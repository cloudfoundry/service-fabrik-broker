'use strict';

const _ = require('lodash');
const lib = require('../../lib');
const Repository = require('../../lib/db').Repository;
const apps = require('../support/apps');
const config = lib.config;

describe('service-fabrik-admin', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('director', function () {
      let numberOfDeployments = 8;
      const base_url = '/admin';
      const name = 'update';
      const args = {};
      const broker_guid = 'eb3303c3-f373-4339-8562-113d1451a6ef';
      const broker_name = config.broker_name;
      const plan_guid = '60750c9c-8937-4caf-9e94-c38cbbbfd191';
      const plan_unique_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const index = 0;
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const org_guid = 'c84c8e58-eedc-4706-91fb-e8d97b333481';
      const instance_id = mocks.director.uuidByIndex(index);
      const deployment_name = mocks.director.deploymentNameByIndex(index);

      before(function () {
        return mocks.setup([]);
      });

      afterEach(function () {
        mocks.reset();
      });

      describe('#getOutdatedDeployments', function () {
        it('should return 200 Ok', function () {
          mocks.director.getDeployments({
            capacity: numberOfDeployments
          });
          mocks.cloudController.findServiceBrokerByName(broker_guid, broker_name);
          mocks.cloudController.getServicePlans(broker_guid, plan_guid, plan_unique_id);
          mocks.cloudController.getServiceInstances(plan_guid, numberOfDeployments);
          mocks.director.getDeploymentManifest(numberOfDeployments);
          mocks.director.diffDeploymentManifest(numberOfDeployments);
          _.each(_.range(numberOfDeployments), index => mocks.cloudController
            .getServiceInstance(mocks.director.uuidByIndex(index), {
              space_guid: space_guid
            }));
          mocks.cloudController.getSpace(space_guid, {
            organization_guid: org_guid
          }, numberOfDeployments);
          return chai
            .request(apps.internal)
            .get(`${base_url}/deployments/outdated`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.deployments).to.have.length(numberOfDeployments);
              mocks.verify();
            });
        });
      });

      describe('#getDeploymentsSummary', function () {
        it('should return 200 Ok', function () {
          mocks.director.getDeployments({
            capacity: numberOfDeployments,
            customParam: 'customValue'
          });
          mocks.cloudController.findServiceBrokerByName(broker_guid, broker_name);
          mocks.cloudController.getSpaces(broker_guid, space_guid);
          mocks.cloudController.getOrganizations(broker_guid, org_guid);
          mocks.cloudController.getPlans(broker_guid, plan_guid, plan_unique_id);
          mocks.cloudController.getServiceInstances(plan_guid, space_guid, org_guid);
          return chai
            .request(apps.internal)
            .get(`${base_url}/deployments/summary`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.deployments).to.have.length(numberOfDeployments);
            });
        });
      });

      describe('#getDeploymentDirectorConfig', function () {
        it('it return the config of the director to which the deployment belongs', function () {
          return chai
            .request(apps.internal)
            .get(`${base_url}/deployments/${deployment_name}/director`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.name).to.equal('bosh');
              expect(res.body).to.have.property('uuid');
              expect(res.body).to.have.property('name');
              expect(res.body).to.have.property('support_create');
              expect(res.body).to.have.property('infrastructure');
              expect(res.body).to.have.property('cpi');
              mocks.verify();
            });
        });
      });

      describe('#updateDeployment', function () {
        it('should initiate a service-fabrik-operation via an update at cloud controller', function () {
          mocks.cloudController.updateServiceInstance(instance_id, body => {
            const token = _.get(body.parameters, 'service-fabrik-operation');
            return support.jwt.verify(token, name, args);
          });

          return chai
            .request(apps.internal)
            .post(`${base_url}/deployments/${deployment_name}/update`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.name).to.equal(name);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });
        it('should initiate a service-fabrik-(update)operation with forbidden manifest changes disable', function () {
          mocks.cloudController.findServicePlan(instance_id, plan_unique_id);
          mocks.director.getDeploymentManifest();
          mocks.director.diffDeploymentManifest();
          mocks.cloudController.updateServiceInstance(instance_id, body => {
            const token = _.get(body.parameters, 'service-fabrik-operation');
            return support.jwt.verify(token, name, args);
          });
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid
          });
          mocks.cloudController.getSpace(space_guid, {
            organization_guid: org_guid
          });
          return chai
            .request(apps.internal)
            .post(`${base_url}/deployments/${deployment_name}/update`)
            .send({
              forbidden_changes: 'false'
            })
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.name).to.equal(name);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });
      });

      describe('#updateOutdatedDeployments', function () {
        const store = {};

        before(function () {
          store.numberOfDeployments = numberOfDeployments;
          numberOfDeployments = 1;
        });

        after(function () {
          numberOfDeployments = store.numberOfDeployments;
        });

        it('should not contain deployments with changes in forbidden sections (and call cloud controller)', function () {
          mocks.director.getDeployments({
            capacity: numberOfDeployments
          });
          mocks.cloudController.findServiceBrokerByName(broker_guid, broker_name);
          mocks.cloudController.getServicePlans(broker_guid, plan_guid, plan_unique_id);
          mocks.cloudController.getServiceInstances(plan_guid, numberOfDeployments);
          mocks.director.getDeploymentManifest(numberOfDeployments);
          mocks.director.diffDeploymentManifest(numberOfDeployments);
          mocks.cloudController.updateServiceInstance(instance_id, body => {
            const token = _.get(body.parameters, 'service-fabrik-operation');
            return support.jwt.verify(token, name, args);
          });
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid
          });
          mocks.cloudController.getSpace(space_guid, {
            organization_guid: org_guid
          });
          return chai
            .request(apps.internal)
            .post(`${base_url}/deployments/outdated/update`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.length(1);
              expect(res.body[0]).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should contain deployments with changes in forbidden sections (and not call cloud controller)', function () {
          const diff = [
            ['jobs:', null],
            ['- name: blueprint_z1', null],
            ['  instances: 2', 'removed'],
            ['  instances: 1', 'added']
          ];
          mocks.director.getDeployments({
            capacity: numberOfDeployments
          });
          mocks.cloudController.findServiceBrokerByName(broker_guid, broker_name);
          mocks.cloudController.getServicePlans(broker_guid, plan_guid, plan_unique_id);
          mocks.cloudController.getServiceInstances(plan_guid, numberOfDeployments);
          mocks.director.getDeploymentManifest(numberOfDeployments);
          mocks.director.diffDeploymentManifest(numberOfDeployments, diff);
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid
          });
          mocks.cloudController.getSpace(space_guid, {
            organization_guid: org_guid
          });
          return chai
            .request(apps.internal)
            .post(`${base_url}/deployments/outdated/update`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.length(1);
              expect(res.body[0]).to.have.property('error');
              expect(res.body[0].error).to.have.status(403);
              mocks.verify();
            });
        });
      });

      describe('#Maintenance', function () {
        let findOneStub, saveStub, searchStub, sandbox;
        const maintenanceInfo = {
          _id: '111111111111111111111111',
          fromVersion: '1.9',
          toVersion: '2.0',
          releaseNotes: 'Test',
          state: 'succeeded',
          updatedBy: 'broker',
          createdBy: 'broker',
          completedAt: '2017-08-02T18:23:32.602Z',
          __v: 0,
          updatedAt: '2017-08-02T18:48:30.265Z',
          createdAt: '2017-08-02T18:23:32.602Z',
          progress: [
            'Going to start Service-Fabrik deployment update'
          ],
        };
        let listStore = [];

        function getMaintenaceInfo() {
          if (listStore.length === 0) {
            return null;
          }
          return listStore[0];
        }

        function saveMaintenance() {
          listStore.push(maintenanceInfo);
          return maintenanceInfo;
        }

        before(function () {
          sandbox = sinon.sandbox.create();
          findOneStub = sandbox.stub(Repository, 'findOne', () => Promise.resolve(getMaintenaceInfo()));
          saveStub = sandbox.stub(Repository, 'save', () => Promise.resolve(saveMaintenance()));
          searchStub = sandbox.stub(Repository, 'search', () => Promise.resolve(({
            list: [maintenanceInfo],
            totalRecordCount: 1,
            nextOffset: -1
          })));
        });

        after(function () {
          sandbox.restore();
        });

        it('should flag service-fabrik in maintenance mode', function () {
          listStore = [];
          return chai
            .request(apps.internal)
            .post(`${base_url}/service-fabrik/maintenance`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(maintenanceInfo);
            });
        });
        it('should error attempt to flag service-fabrik in maintenance mode if it is already in maintenace', function () {
          listStore.push(maintenanceInfo);
          return chai
            .request(apps.internal)
            .post(`${base_url}/service-fabrik/maintenance`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              progress: 'SF Deployed'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              expect(res.body.errorMessage).to.eql('System already in maintenance mode');
              expect(res.body.maintenanceInfo).to.eql(maintenanceInfo);
            });
        });
        it('should update progress of on-going maintenance mode ', function () {
          listStore.push(maintenanceInfo);
          return chai
            .request(apps.internal)
            .put(`${base_url}/service-fabrik/maintenance`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .send({
              progress: 'SF Deployed'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(maintenanceInfo);
            });
        });
        it('update progress of maintenance mode should fail if service-fabrik not in maintenance mode', function () {
          listStore = [];
          return chai
            .request(apps.internal)
            .put(`${base_url}/service-fabrik/maintenance`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              expect(res.body.errorMessage).to.eql('System not in maintenance mode');
            });
        });
        it('should get status of an on-going maintenance mode ', function () {
          listStore.push(maintenanceInfo);
          return chai
            .request(apps.internal)
            .get(`${base_url}/service-fabrik/maintenance`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(_.chain(_.clone(maintenanceInfo))
                .set('system_in_maintenance', true)
                .value());
            });
        });
        it('should return 404 if service-fabrik is not in maintenance mode ', function () {
          listStore = [];
          return chai
            .request(apps.internal)
            .get(`${base_url}/service-fabrik/maintenance`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(404);
              expect(res.body.system_in_maintenance).to.eql(false);
            });
        });
        it('should list history of maintenance mode ', function () {
          return chai
            .request(apps.internal)
            .get(`${base_url}/service-fabrik/maintenance/history`)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.list).to.eql([maintenanceInfo]);
              expect(res.body.totalRecordCount).to.eql(1);
              expect(res.body.nextOffset).to.eql(-1);
            });
        });
      });
    });
  });
});