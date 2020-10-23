'use strict';

const Promise = require('bluebird');
const {
  CONST,
  commonFunctions: {
    encodeBase64
  }
} = require('@sf/common-utils');
const MultitenancyService = require('../src/multitenancy-operator/MultitenancyService');
const MultitenancyBindService = require('../src/multitenancy-operator/MultitenancyBindService');

describe('#MultitenancyService', function () {
  this.timeout(0);
  describe('instances', function () {
    /* jshint expr:true */
    describe('Multitenancy', function () {
      const index = mocks.director.networkSegmentIndex;
      const service_id = '6db542eb-8187-4afc-8a85-e08b4a3cc24e';
      const plan_id = '2fcf6682-5a4a-4297-a7cd-a97bbe085b8e';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'fe171a35-3107-4cee-bc6b-0051617f892e';
      const instance_id = mocks.director.uuidByIndex(index);
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const instance_name = 'postgresSharedInstance';
      const parameters = {
        dedicated_instance: `${instance_name}`
      };
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
        mocks.verify();
      });

      afterEach(function () {
        mocks.reset();
      });

      describe('#provision', function () {
        it('returns 201 created', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getServiceInstancesInSpaceWithName(instance_name, space_guid, true);
          mocks.agent.getInfo();
          mocks.multitenancyAgent.createTenant(instance_id);
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
          const changeObject = {
            object: {
              metadata: {
                name: instance_id,
                selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/postgresqlmts/${instance_id}`
              },
              spec: {
                options: JSON.stringify(options)
              },
              status: {
                state: 'in_queue'
              }
            }
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, changeObject);
          const changeObject1 = {
            object: {
              metadata: {
                name: instance_id,
                selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/postgresqlmts/${instance_id}`
              },
              operatorMetadata: {
                dedicatedInstanceDeploymentName: deployment_name
              },
              spec: {
                options: JSON.stringify(options)
              },
              status: {
                state: 'in_queue'
              }
            }
          };
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, changeObject1);

          return MultitenancyService.createInstance(instance_id, options, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT)
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
          return MultitenancyService.createInstance(instance_id, options, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT)
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
          mocks.multitenancyAgent.updateTenant(instance_id);
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
          const operatorMetadata = {
            operatorMetadata: {
              dedicatedInstanceDeploymentName: deployment_name
            }
          };
          return MultitenancyService.createInstance(instance_id, options, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT)
            .then(service => service.update(operatorMetadata))
            .then(() => {
              mocks.verify();
            });
        });
      });

      describe('#bind', function () {
        it('returns 201 Created', function () {
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.multitenancyAgent.createTenantCredentials(instance_id);

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
          const payload2 = {
            apiVersion: 'deployment.servicefabrik.io/v1alpha1',
            kind: 'PostgresqlMT',
            metadata: {
              name: instance_id,
              labels: {
                state: 'in_queue'
              }
            },
            operatorMetadata: {
              dedicatedInstanceDeploymentName: deployment_name
            },
            spec: {
              options: JSON.stringify({
                service_id: service_id,
                plan_id: plan_id,
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                },
                organization_guid: organization_guid,
                space_guid: space_guid,
                parameters: {
                  dedicated_instance: `${instance_name}`
                }
              })
            },
            status: {
              state: 'succeeded',
              lastOperation: '{}',
              response: '{}'
            }
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, payload2);
          return MultitenancyBindService.createInstance(instance_id, options, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT)
            .then(service => service.bind(options))
            .then(res => {
              expect(res).to.eql(mocks.multitenancyAgent.credentials);
              mocks.verify();
            });
        });
      });

      describe('#unbind', function () {
        it('returns 200 OK', function () {
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.multitenancyAgent.deleteTenantCredentials(instance_id);
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
          const payload2 = {
            apiVersion: 'deployment.servicefabrik.io/v1alpha1',
            kind: 'PostgresqlMT',
            metadata: {
              name: instance_id,
              labels: {
                state: 'in_queue'
              }
            },
            operatorMetadata: {
              dedicatedInstanceDeploymentName: deployment_name
            },
            spec: {
              options: JSON.stringify({
                service_id: service_id,
                plan_id: plan_id,
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                },
                organization_guid: organization_guid,
                space_guid: space_guid,
                parameters: {
                  dedicated_instance: `${instance_name}`
                }
              })
            },
            status: {
              state: 'succeeded',
              lastOperation: '{}',
              response: '{}'
            }
          };
          let dummyBindResource = {
            status: {
              response: encodeBase64(mocks.multitenancyAgent.credentials),
              state: 'succeeded'
            }
          };
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, binding_id, dummyBindResource, 1, 200);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, instance_id, payload2);
          return MultitenancyBindService.createInstance(instance_id, options, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT)
            .then(service => service.unbind(options))
            .then(() => {
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
          mocks.multitenancyAgent.deleteTenant(instance_id);
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
          const operatorMetadata = {
            operatorMetadata: {
              dedicatedInstanceDeploymentName: deployment_name
            }
          };
          return MultitenancyService.createInstance(instance_id, options, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT)
            .then(service => service.delete(operatorMetadata))
            .then(() => {
              mocks.verify();
            });
        });

        it('returns 410 Gone when parent service instance is deleted', function () {
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.director.getDeploymentInstances(deployment_name, undefined, undefined, undefined, false);
          mocks.director.getDeployment(deployment_name, false, undefined, 1);
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
          const operatorMetadata = {
            operatorMetadata: {
              dedicatedInstanceDeploymentName: deployment_name
            }
          };
          return MultitenancyService.createInstance(instance_id, options, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT)
            .then(service => service.delete(operatorMetadata))
            .catch(res => {
              expect(res).to.have.status(410);
              mocks.verify();
            });
        });
      });
    });
  });
});
