'use strict';

const Promise = require('bluebird');
const {
  CONST,
  commonFunctions: {
    encodeBase64
  }
} = require('@sf/common-utils');
const VirtualHostService = require('../../applications/operators/virtualhost-operator/VirtualHostService');

describe('#VirtualHostService', function () {
  describe('instances', function () {
    describe('virtualhost', function () {
      const service_id = '19f17a7a-5247-4ee2-94b5-03eac6756388';
      const plan_id = 'd035f948-5d3a-43d7-9aec-954e134c3e9d';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = '5a877873-7659-40ea-bdcb-096e9ae0cbb3';
      const parent_instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
      const deployment_name = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const instance_name = 'rmq';
      const parameters = {
        dedicated_rabbitmq_instance: `${instance_name}`
      };
      const accepts_incomplete = true;
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
        },
        operatorMetadata: {
          deploymentName: deployment_name
        }
      };
      Promise.onPossiblyUnhandledRejection(() => {});

      afterEach(function () {
        mocks.reset();
      });

      describe('#provision', function () {
        it('returns 201 created', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, parent_instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id);
          mocks.cloudController.getServiceInstancesInSpaceWithName(instance_name, space_guid, true);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.createVirtualHost(instance_id);
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
            .then(() => {
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
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.createCredentials(instance_id);
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
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.deleteCredentials(instance_id);
          let dummyBindResource = {
            status: {
              response: encodeBase64(mocks.virtualHostAgent.credentials),
              state: 'succeeded'
            }
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, binding_id, dummyBindResource, 1, 200);
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
            .then(() => {
              mocks.verify();
            });
        });
      });


      describe('#deprovision', function () {
        it('returns 200 OK', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.virtualHostAgent.deleteVirtualHost(instance_id);
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
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, dummyDeploymentResource);
          mocks.director.getDeploymentInstances(deployment_name, undefined, undefined, undefined, false);
          mocks.director.getDeployment(deployment_name, false, undefined, 1);
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
