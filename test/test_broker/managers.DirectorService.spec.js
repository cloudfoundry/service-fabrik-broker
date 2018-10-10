'use strict';

const _ = require('lodash');
const errors = require('../../common/errors');
const Promise = require('bluebird');
const config = require('../../common/config');
const catalog = require('../../common/models').catalog;
const ScheduleManager = require('../../jobs');
const CONST = require('../../common/constants');
const iaas = require('../../data-access-layer/iaas');
const backupStore = iaas.backupStore;
const DirectorService = require('../../managers/bosh-manager/DirectorService');


describe('#DirectorService', function () {
  describe('instances', function () {
    /* jshint expr:true */
    describe('director', function () {
      const index = mocks.director.networkSegmentIndex;
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan = catalog.getPlan(plan_id);
      const plan_id_update = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const instance_id = mocks.director.uuidByIndex(index);
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const binding_id = 'd336b15c-37d6-4249-b3c7-430d5153a0d8';
      const app_guid = 'app-guid';
      const task_id = 4711;
      const parameters = {
        foo: 'bar'
      };
      const deploymentHookRequestBody = {
        phase: 'PreCreate',
        actions: ['Blueprint', 'ReserveIps'],
        context: {
          params: {
            context: {
              platform: 'cloudfoundry',
              organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
              space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
            },
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
            parameters: {
              'foo': 'bar'
            },
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f'
          },
          deployment_name: 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
          sf_operations_args: {},
          instance_guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa'
        }
      };

      const deploymentHookRequestBodyNoContext = {
        phase: 'PreCreate',
        actions: ['Blueprint', 'ReserveIps'],
        context: {
          params: {
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
            parameters: {
              'foo': 'bar'
            },
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f'
          },
          deployment_name: 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
          sf_operations_args: {},
          instance_guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa'
        }
      };
      const accepts_incomplete = true;
      const container = backupStore.containerName;
      const deferred = Promise.defer();
      Promise.onPossiblyUnhandledRejection(() => {});
      let getScheduleStub;
      const dummyDeploymentResource = {
        metadata:{
          annotations: {
            labels: 'dummy'
          }
        }
      };
      before(function () {
        backupStore.cloudProvider = new iaas.CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule');
        getScheduleStub.withArgs().returns(deferred.promise);
        plan.service.subnet = null;
        return mocks.setup(
          backupStore.cloudProvider.getContainer()
        );
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
          mocks.deploymentHookClient.executeDeploymentActions(200, deploymentHookRequestBody);
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
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.create(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'create',
                parameters: parameters,
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                }
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });

        it('no context returns 202 Accepted', function () {
          mocks.director.getDeployments({
            queued: true
          });
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.deploymentHookClient.executeDeploymentActions(200, deploymentHookRequestBodyNoContext);
          mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
            platform: 'cloudfoundry'
          });
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.create(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'create',
                parameters: parameters,
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 Accepted: In K8S platform', function () {
          mocks.director.getDeployments({
            queued: true
          });
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context.params.context = _.chain(expectedRequestBody.context.params.context)
            .set('namespace', 'default')
            .set('platform', 'kubernetes')
            .omit('organization_guid')
            .omit('space_guid')
            .value();
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'kubernetes',
              namespace: 'default'
            },
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.create(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'create',
                parameters: parameters,
                context: {
                  platform: 'kubernetes',
                  namespace: 'default'
                }
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 Accepted when invoked with bosh name', function () {
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          _.chain(expectedRequestBody.context)
            .set('deployment_name', deployment_name)
            .set('instance_guid', instance_id)
            .set('sf_operations_args', {
              'bosh_director_name': 'bosh'
            })
            .value();
          _.chain(expectedRequestBody.context.params)
            .set('accepts_incomplete', true)
            .value();
          expectedRequestBody.context.params.parameters = _.chain(expectedRequestBody.context.params.parameters)
            .set('bosh_director_name', 'bosh')
            .omit('foo')
            .set('username', 'admin')
            .set('password', 'admin')
            .value();
          mocks.director.getDeployments({
            queued: true
          });
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.uaa.getAccessToken();
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
            parameters: {
              bosh_director_name: 'bosh',
              username: 'admin',
              password: 'admin'
            },
            accepts_incomplete: accepts_incomplete
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.create(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'create',
                parameters: {
                  bosh_director_name: 'bosh',
                  username: 'admin',
                  password: 'admin'
                },
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                },
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
      });


      describe('#update', function () {
        it('no context : returns 202 Accepted', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          _.set(expectedRequestBody.context.params, 'plan_id', plan_id_update);
          _.set(expectedRequestBody.context.params, 'previous_values', {
            plan_id: plan_id,
            service_id: service_id
          });
          expectedRequestBody.context.params = _.chain(expectedRequestBody.context.params)
            .omit('context')
            .omit('space_guid')
            .omit('organization_guid')
            .value();
          expectedRequestBody.context.params.previous_manifest = mocks.director.manifest;
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
          mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
            platform: 'cloudfoundry'
          });
          mocks.director.getDeployment(deploymentName, true, undefined);
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deploymentName);
          mocks.agent.getInfo();
          mocks.agent.preUpdate();
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          const options = {
            service_id: service_id,
            plan_id: plan_id_update,
            parameters: parameters,
            previous_values: {
              plan_id: plan_id,
              service_id: service_id
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.update(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'update',
                parameters: parameters,
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 Accepted', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          _.set(expectedRequestBody.context.params, 'plan_id', plan_id_update);
          _.set(expectedRequestBody.context.params, 'previous_values', {
            plan_id: plan_id,
            service_id: service_id
          });
          expectedRequestBody.context.params = _.chain(expectedRequestBody.context.params)
            .omit('space_guid')
            .omit('organization_guid')
            .value();
          expectedRequestBody.context.params.previous_manifest = mocks.director.manifest;
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeployment(deploymentName, true, undefined);
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deploymentName);
          mocks.agent.getInfo();
          const options = {
            service_id: service_id,
            plan_id: plan_id_update,
            parameters: parameters,
            context: context,
            previous_values: {
              plan_id: plan_id,
              service_id: service_id
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.update(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'update',
                parameters: parameters,
                context: context
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 Accepted: In K8s platform', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          const context = {
            platform: 'kubernetes',
            namespace: 'default'
          };
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          _.set(expectedRequestBody.context.params, 'plan_id', plan_id_update);
          _.set(expectedRequestBody.context.params, 'previous_values', {
            plan_id: plan_id,
            service_id: service_id
          });
          expectedRequestBody.context.params = _.chain(expectedRequestBody.context.params)
            .set('context', context)
            .omit('space_guid')
            .omit('organization_guid')
            .value();
          expectedRequestBody.context.params.previous_manifest = mocks.director.manifest;
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeployment(deploymentName, true, undefined);
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deploymentName);
          //mocks.agent.preUpdate();
          mocks.agent.getInfo();
          const options = {
            service_id: service_id,
            plan_id: plan_id_update,
            parameters: parameters,
            context: context,
            previous_values: {
              plan_id: plan_id,
              service_id: service_id
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.update(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'update',
                parameters: parameters,
                context: context
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });

        it('returns 202 when preupdate is not implemented by agent', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          _.set(expectedRequestBody.context.params, 'plan_id', plan_id_update);
          _.set(expectedRequestBody.context.params, 'previous_values', {
            plan_id: plan_id,
            service_id: service_id
          });
          expectedRequestBody.context.params = _.chain(expectedRequestBody.context.params)
            .omit('context')
            .omit('space_guid')
            .omit('organization_guid')
            .value();
          expectedRequestBody.context.params.previous_manifest = mocks.director.manifest;
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
            platform: 'cloudfoundry'
          });
          mocks.director.getDeployment(deploymentName, true, undefined);
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deploymentName);
          mocks.agent.getInfo();
          //mocks.agent.preUpdate();
          const options = {
            service_id: service_id,
            plan_id: plan_id_update,
            parameters: parameters,
            previous_values: {
              plan_id: plan_id,
              service_id: service_id
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.update(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'update',
                parameters: parameters,
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 when preupdate feature is not implemented by agent', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
            platform: 'cloudfoundry'
          });
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          _.set(expectedRequestBody.context.params, 'plan_id', plan_id_update);
          _.set(expectedRequestBody.context.params, 'previous_values', {
            plan_id: plan_id,
            service_id: service_id
          });
          expectedRequestBody.context.params = _.chain(expectedRequestBody.context.params)
            .omit('context')
            .omit('space_guid')
            .omit('organization_guid')
            .value();
          expectedRequestBody.context.params.previous_manifest = mocks.director.manifest;
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeployment(deploymentName, true, undefined);
          mocks.director.createOrUpdateDeployment(task_id);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deploymentName);
          mocks.agent.getInfo(1, 'preupdate');
          const options = {
            service_id: service_id,
            plan_id: plan_id_update,
            parameters: parameters,
            previous_values: {
              plan_id: plan_id,
              service_id: service_id
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.update(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                cached: false,
                type: 'update',
                parameters: parameters,
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
      });



      describe('#deprovision', function () {
        it('returns 202 Accepted', function () {
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context = _.chain(expectedRequestBody.context)
            .omit('params')
            .omit('sf_operations_args')
            .value();
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_DELETE;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          const restoreFilename = `${space_guid}/restore/${service_id}.${instance_id}.json`;
          const restorePathname = `/${container}/${restoreFilename}`;
          mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.deprovision();
          mocks.cloudController.findSecurityGroupByName(instance_id);
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid
          });
          mocks.cloudController.deleteSecurityGroup(instance_id);
          mocks.director.deleteDeployment(task_id);
          mocks.cloudProvider.remove(restorePathname);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            accepts_incomplete: accepts_incomplete
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.delete(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                type: 'delete',
                context: {
                  platform: 'cloudfoundry'
                }
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 Accepted : existing deployments having no platform-context', function () {
          const restoreFilename = `${space_guid}/restore/${service_id}.${instance_id}.json`;
          const restorePathname = `/${container}/${restoreFilename}`;
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context = _.chain(expectedRequestBody.context)
            .omit('params')
            .omit('sf_operations_args')
            .value();
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_DELETE;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeploymentProperty(deployment_name, false, 'platform-context', {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.deprovision();
          mocks.cloudController.findSecurityGroupByName(instance_id);
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid
          });
          mocks.cloudController.deleteSecurityGroup(instance_id);
          mocks.director.deleteDeployment(task_id);
          mocks.cloudProvider.remove(restorePathname);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            accepts_incomplete: accepts_incomplete
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.delete(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                type: 'delete',
                context: {
                  platform: 'cloudfoundry'
                }
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
        it('returns 202 Accepted : In K8S Platform', function () {
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context = _.chain(expectedRequestBody.context)
            .omit('params')
            .omit('sf_operations_args')
            .value();
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_DELETE;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
            platform: 'kubernetes',
            namespace: 'default'
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.director.deleteDeployment(task_id);
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            accepts_incomplete: accepts_incomplete
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.delete(options))
            .then(res => {
              expect(_.pick(res, ['type', 'parameters', 'context', 'cached'])).to.eql({
                type: 'delete',
                context: {
                  platform: 'kubernetes'
                }
              });
              expect(res.task_id).to.eql(`${deployment_name}_${task_id}`);
              mocks.verify();
            });
        });
      });



      describe('#lastOperation', function () {
        it('create: returns 200 OK (state = in progress)', function () {
          mocks.director.getDeploymentTask(task_id, 'processing');
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
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'create',
            context: {
              platform: 'cloudfoundry',
              organization_guid: organization_guid,
              space_guid: space_guid
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Create deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });

        it('create: returns 200 OK (state = succeeded)', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.director.getDeploymentTask(task_id, 'done');
          mocks.director.createDeploymentProperty('platform-context', context);
          mocks.cloudController.createSecurityGroup(instance_id);
          const payload = {
            repeatInterval: CONST.SCHEDULE.RANDOM,
            timeZone: 'Asia/Kolkata'
          };
          mocks.serviceFabrikClient.scheduleUpdate(instance_id, payload);
          config.scheduler.jobs.service_instance_update.run_every_xdays = 15;
          config.mongodb.provision.plan_id = 'TEST';
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
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'create',
            context: {
              platform: 'cloudfoundry',
              organization_guid: organization_guid,
              space_guid: space_guid
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });

        it('create: returns 200 OK (state = in progress): In K8S platform', function () {
          mocks.director.getDeploymentTask(task_id, 'processing');
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'kubernetes',
              namespace: 'default'
            },
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'create',
            context: {
              platform: 'kubernetes',
              namespace: 'default'
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Create deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });

        it('create: returns 200 OK (state = succeeded): In K8S platform', function () {
          const context = {
            platform: 'kubernetes',
            namespace: 'default'
          };
          mocks.director.getDeploymentTask(task_id, 'done');
          const payload = {
            repeatInterval: CONST.SCHEDULE.RANDOM,
            timeZone: 'Asia/Kolkata'
          };
          mocks.director.createDeploymentProperty('platform-context', context);
          mocks.serviceFabrikClient.scheduleUpdate(instance_id, payload);
          config.scheduler.jobs.service_instance_update.run_every_xdays = 15;
          config.mongodb.provision.plan_id = 'TEST';
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            context: context,
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'create',
            context: context
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Create deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });

        it('update: returns 200 OK (state = in progress)', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.director.getDeploymentTask(task_id, 'processing');
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            context: context,
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'update',
            context: context
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Update deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });

        it('update: returns 200 OK (state = succeeded)', function () {
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          mocks.director.getDeploymentTask(task_id, 'done');
          mocks.cloudController.findSecurityGroupByName(instance_id);
          config.scheduler.jobs.service_instance_update.run_every_xdays = 15;
          config.mongodb.provision.plan_id = 'TEST';
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            context: context,
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'update',
            context: context
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Update deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });


        it('delete: returns 200 OK (state = in progress)', function () {
          const context = {
            platform: 'cloudfoundry'
          };
          mocks.director.getDeploymentProperty(deployment_name, false, 'platform-context', context);
          mocks.director.getDeploymentTask(task_id, 'processing');
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'delete'
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Delete deployment ${deployment_name} is still in progress`,
                state: 'in progress'
              });
              mocks.verify();
            });
        });

        it('delete: returns 200 OK (state = succeeded)', function () {
          const context = {
            platform: 'cloudfoundry'
          };
          mocks.director.getDeploymentProperty(deployment_name, false, 'platform-context', context);
          mocks.director.getDeploymentTask(task_id, 'done');
          config.scheduler.jobs.service_instance_update.run_every_xdays = 15;
          config.mongodb.provision.plan_id = 'TEST';
          const options = {
            service_id: service_id,
            plan_id: plan_id,
            organization_guid: organization_guid,
            space_guid: space_guid,
            parameters: parameters
          };
          const response = {
            task_id: `${deployment_name}_${task_id}`,
            type: 'delete'
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.lastOperation(response))
            .then(res => {
              expect(_.pick(res, ['description', 'state'])).to.eql({
                description: `Delete deployment ${deployment_name} succeeded at 2016-07-04T10:58:24.000Z`,
                state: 'succeeded'
              });
              mocks.verify();
            });
        });
      });

      describe('#bind', function () {
        it('no context : returns 201 Created', function (done) {
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context = _.chain(expectedRequestBody.context)
            .set('id', binding_id)
            .set('parameters', {})
            .omit('params')
            .omit('sf_operations_args')
            .value();
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_BIND;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
            platform: 'cloudfoundry'
          });
          config.mongodb.provision.plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
          deferred.reject(new errors.NotFound('Schedule not found'));
          const WAIT_TIME_FOR_ASYNCH_SCHEDULE_OPERATION = 0;
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.createCredentials();
          mocks.director.createBindingProperty(binding_id);
          mocks.serviceFabrikClient.scheduleBackup(instance_id, {
            type: CONST.BACKUP.TYPE.ONLINE,
            repeatInterval: '8 hours'
          });
          const options = {
            binding_id: binding_id,
            service_id: service_id,
            plan_id: plan_id,
            app_guid: app_guid,
            bind_resource: {
              app_guid: app_guid
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.bind(options))
            .then(res => {
              expect(res).to.eql(mocks.agent.credentials);
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
        it('returns 201 Created', function (done) {
          config.mongodb.provision.plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
          deferred.reject(new errors.NotFound('Schedule not found'));
          const WAIT_TIME_FOR_ASYNCH_SCHEDULE_OPERATION = 0;
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context = _.chain(expectedRequestBody.context)
            .set('id', binding_id)
            .set('parameters', {})
            .omit('params')
            .omit('sf_operations_args')
            .value();
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_BIND;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.createCredentials();
          mocks.director.createBindingProperty(binding_id);
          mocks.serviceFabrikClient.scheduleBackup(instance_id, {
            type: CONST.BACKUP.TYPE.ONLINE,
            repeatInterval: '8 hours'
          });
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
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.bind(options))
            .then(res => {
              expect(res).to.eql(mocks.agent.credentials);
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
          const context = {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          };
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context = _.chain(expectedRequestBody.context)
            .set('id', binding_id)
            .omit('params')
            .omit('sf_operations_args')
            .value();
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UNBIND;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.director.getBindingProperty(binding_id);
          mocks.agent.getInfo();
          mocks.agent.deleteCredentials();
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
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.unbind(options))
            .then(res => {
              expect(res).to.eql({
                'body': '',
                'headers': {},
                'statusCode': 204,
                'statusMessage': null
              });
              mocks.verify();
            });
        });
        it('returns 200 OK : for existing deployment having no platform-context', function () {
          const expectedRequestBody = _.cloneDeep(deploymentHookRequestBody);
          expectedRequestBody.context = _.chain(expectedRequestBody.context)
            .set('id', binding_id)
            .omit('params')
            .omit('sf_operations_args')
            .value();
          expectedRequestBody.phase = CONST.SERVICE_LIFE_CYCLE.PRE_UNBIND;
          mocks.deploymentHookClient.executeDeploymentActions(200, expectedRequestBody);
          mocks.director.getDeploymentProperty(deployment_name, false, 'platform-context', undefined);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.director.getBindingProperty(binding_id);
          mocks.agent.getInfo();
          mocks.agent.deleteCredentials();
          mocks.director.deleteBindingProperty(binding_id);
          const options = {
            binding_id: binding_id,
            service_id: service_id,
            plan_id: plan_id,
            app_guid: app_guid,
            bind_resource: {
              app_guid: app_guid
            }
          };
          return DirectorService.createInstance(instance_id, options)
            .then(service => service.unbind(options))
            .then(res => {
              expect(res).to.eql({
                'body': '',
                'headers': {},
                'statusCode': 204,
                'statusMessage': null
              });
              mocks.verify();
            });
        });
      });
    });
  });
});