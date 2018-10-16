'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../common/config');
const CONST = require('../../common/constants');
const iaas = require('../../data-access-layer/iaas');
const virtualHostStore = iaas.virtualHostStore;
const VirtualHostService = require('../../operators/virtualhost-operator/VirtualHostService');


describe('#VirtualHostService', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('virtualhost', function () {
      const index = mocks.director.networkSegmentIndex;
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
      const dummyDeploymentResource = {
        metadata: {
          annotations: {
            labels: 'dummy'
          }
        }
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.cloudController.getServiceInstancesInSpaceWithName(instance_name, space_guid, true);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.createVirtualHost(instance_id);
          mocks.cloudProvider.upload(pathname, () => {
            return true;
          });
          mocks.cloudProvider.headObject(pathname);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'cloudfoundry',
              organization_guid: organization_guid,
              space_guid: space_guid
            },
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          return VirtualHostService.createVirtualHostService(instance_id, options)
            .then(service => service.create())
            .then(res => {
              expect(_.pick(res, ['deployment_name', 'instance_guid'])).to.eql({
                deployment_name: deployment_name,
                instance_guid: instance_id
              });
              mocks.verify();
            });
        });

        it('returns 404 not found when wrong service instance name is passed.', function () {
          mocks.cloudController.getServiceInstancesInSpaceWithName(instance_name, space_guid, false);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'cloudfoundry',
              organization_guid: organization_guid,
              space_guid: space_guid
            },
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          return VirtualHostService.createVirtualHostService(instance_id, options)
            .then(service => service.create())
            .catch(res => {
              expect(res).to.have.status(404);
              mocks.verify();
            });
        });
      });


      describe('#update', function () {
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.updateVirtualHost(instance_id);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            parameters: parameters,
            context: context,
            previous_values: {
              plan_id: plan_id,
              service_id: service_id
            }
          };
          return VirtualHostService.createVirtualHostService(instance_id, options)
            .then(service => service.update())
            .then(() => {
              mocks.verify();
            });
        });
      });

      describe('#bind', function () {
        it('returns 201 Created', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.createCredentials(instance_id);
          mocks.director.createBindingProperty(binding_id, {}, deployment_name, mocks.virtualHostAgent.credentials);
          const options = {
            binding_id: binding_id,
            service_id: service_id,
            plan_id: plan_id,
            app_guid: app_guid,
            context: context,
            bind_resource: {
              app_guid: app_guid
            }
          };
          return VirtualHostService.createVirtualHostService(instance_id, options)
            .then(service => service.bind(options))
            .then(res => {
              expect(res).to.eql(mocks.virtualHostAgent.credentials);
              mocks.verify();
            });
        });
      });

      describe('#unbind', function () {
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.deleteCredentials(instance_id);
          mocks.director.getBindingProperty(binding_id, {}, deployment_name, false, mocks.virtualHostAgent.credentials);
          mocks.director.deleteBindingProperty(binding_id);
          const options = {
            binding_id: binding_id,
            service_id: service_id,
            plan_id: plan_id,
            app_guid: app_guid,
            context: context,
            bind_resource: {
              app_guid: app_guid
            }
          };
          return VirtualHostService.createVirtualHostService(instance_id, options)
            .then(service => service.unbind(options))
            .then(res => {
              expect(res.body).to.eql('');
              mocks.verify();
            });
        });
      });


      describe('#deprovision', function () {
        it('returns 200 OK', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.deleteVirtualHost(instance_id);
          mocks.cloudProvider.remove(pathname);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            accepts_incomplete: accepts_incomplete
          };
          return VirtualHostService.createVirtualHostService(instance_id, options)
            .then(service => service.delete())
            .then(() => {
              mocks.verify();
            });
        });
        it('returns 410 Gone when parent service instance is deleted', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.director.getDeploymentInstances(deployment_name, undefined, undefined, undefined, false);
          mocks.director.getDeployment(deployment_name, false, undefined, 1);
          mocks.cloudProvider.download(pathname, data);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            accepts_incomplete: accepts_incomplete
          };
          return VirtualHostService.createVirtualHostService(instance_id, options)
            .then(service => service.delete())
            .catch(res => {
              expect(res).to.have.status(410);
              mocks.verify();
            });
        });
      });
    });
  });
});