'use strict';

const _ = require('lodash');
const lib = require('../../lib');
const apps = require('../../apps');
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
          mocks.cloudController.getOrganisations(broker_guid, org_guid);
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
    });
  });
});