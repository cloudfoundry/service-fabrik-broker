'use strict';

const lib = require('../../../broker/lib');
const Promise = require('bluebird');
const app = require('../support/apps').internal;
const config = lib.config;
const iaas = require('../../../data-access-layer/iaas');
const virtualHostStore = iaas.virtualHostStore;

describe('service-broker-api', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('virtualHost', function () {
      const base_url = '/cf/v2';
      const index = mocks.director.networkSegmentIndex;
      const api_version = '2.12';
      const service_id = '19f17a7a-5247-4ee2-94b5-03eac6756388';
      const plan_id = 'd035f948-5d3a-43d7-9aec-954e134c3e9d';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = mocks.director.uuidByIndex(index);
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const instance_name = 'rmq';
      const parameters = {
        dedicated_rabbitmq_instance: `${instance_name}`
      };
      const accepts_incomplete = true;
      const protocol = config.external.protocol;
      const host = config.external.host;
      const dashboard_url = `${protocol}://${host}/manage/instances/${service_id}/${plan_id}/${instance_id}`;
      const container = virtualHostStore.containerName;
      const data = {
        instance_guid: instance_id,
        deployment_name: deployment_name
      };
      const filename = `virtual_hosts/${instance_id}/${instance_id}.json`;
      const pathname = `/${container}/${filename}`;
      const context = {
        platform: 'cloudfoundry',
        organization_guid: organization_guid,
        space_guid: space_guid
      };
      Promise.onPossiblyUnhandledRejection(() => {});

      before(function () {
        virtualHostStore.cloudProvider = new iaas.CloudProviderClient(config.virtual_host.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        return mocks.setup([
          virtualHostStore.cloudProvider.getContainer()
        ]);
      });

      afterEach(function () {
        mocks.reset();
      });

      describe('#provision', function () {
        it('returns 201 created', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.cloudController.getServiceInstancesInSpaceWithName(instance_name, space_guid, true);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.createVirtualHost(instance_id);
          mocks.cloudProvider.upload(pathname, () => {
            return true;
          });
          mocks.cloudProvider.headObject(pathname);
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
              context: context,
              accepts_incomplete: accepts_incomplete
            })
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body.dashboard_url).to.equal(dashboard_url);
              mocks.verify();
            });
        });
        it('returns 404 not found when wrong service instance name is passed.', function () {
          mocks.cloudController.getServiceInstancesInSpaceWithName(instance_name, space_guid, false);
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
              accepts_incomplete: accepts_incomplete,
              context: context
            })
            .catch(res => {
              expect(res).to.have.status(404);
              mocks.verify();
            });
        });
      });

      describe('#bind', function () {
        it('returns 201 Created', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.createCredentials(instance_id);
          mocks.director.createBindingProperty(binding_id, {}, deployment_name, mocks.virtualHostAgent.credentials);
          mocks.cloudProvider.download(pathname, data);
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
              },
              context: context
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql({
                credentials: mocks.virtualHostAgent.credentials
              });
            });
        });
      });

      describe('#unbind', function () {
        it('returns 200 OK', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.deleteCredentials(instance_id);
          mocks.director.getBindingProperty(binding_id, {}, deployment_name, false, mocks.virtualHostAgent.credentials);
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

      describe('#deprovision', function () {
        it('returns 200 OK', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.deleteVirtualHost(instance_id);
          mocks.cloudProvider.remove(pathname);
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
              expect(res).to.have.status(200);
              mocks.verify();
            });
        });
        it('returns 410 Gone when parent service instance is deleted', function () {
          mocks.director.getDeploymentInstances(deployment_name, undefined, undefined, undefined, false);
          mocks.director.getDeployment(deployment_name, false, undefined, 1);
          mocks.cloudProvider.download(pathname, data);
          mocks.cloudProvider.remove(pathname);
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
              expect(res).to.have.status(410);
              mocks.verify();
            });
        });
      });
    });
  });
});