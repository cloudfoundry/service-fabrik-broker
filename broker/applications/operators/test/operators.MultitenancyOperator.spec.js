'use strict';

const _ = require('lodash');
const JSONStream = require('json-stream');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const config = require('@sf/app-config');
const { CONST } = require('@sf/common-utils');
const {
  ApiServerClient,
  apiServerClient
} = require('@sf/eventmesh');
const MultitenancyService = require('../src/multitenancy-operator/MultitenancyService');
const service_id = '6db542eb-8187-4afc-8a85-e08b4a3cc24e';
const plan_id = '2fcf6682-5a4a-4297-a7cd-a97bbe085b8e';
const instance_id = 'e68446f8-023a-404a-af84-12d1ab4c8ac1';
const space_guid = 'fe171a35-3107-4cee-bc6b-0051617f892e';
const organization_guid = '00060d60-067d-41ee-bd28-3bd34f220036';
const index = mocks.director.networkSegmentIndex;
const deployment_name = mocks.director.deploymentNameByIndex(index);


const jsonWriteDelay = 50;

const MultitenancyOperatorDummy = {
  registerWatcherDummy: () => {},
  createInstanceDummy: () => {},
  createDummy: () => {},
  updateDummy: () => {},
  deleteDummy: () => {},
  getOperationOptionsDummy: () => {},
  createInstanceFake: () => {}

};
const resultOptions = {
  plan_id: plan_id
};


const MultitenancyOperator = proxyquire('../src/multitenancy-operator/MultitenancyOperator', {
  '@sf/eventmesh': {
    'apiServerClient': {
      'getOptions': function (opts) {
        MultitenancyOperatorDummy.getOperationOptionsDummy(opts);
        return Promise.resolve(resultOptions);
      }
    }
  }
});

function initDefaultBMTest(jsonStream, sandbox, registerWatcherStub) {
  /* jshint unused:false */
  const bm = new MultitenancyOperator(CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, CONST.MULTITENANCY_SERVICE_TYPE.MULTITENANCYSERVICE);
  bm.init();
  return Promise.delay(100)
    .then(() => {
      expect(registerWatcherStub.callCount).to.equal(1);
      expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT);
      expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      expect(registerWatcherStub.firstCall.args[3]).to.eql('state in (in_queue,update,delete)');
      registerWatcherStub.restore();
    });
}

describe('multitenancy-operator', function () {
  describe('MultitenancyOperator', function () {
    let createInstanceSpy, createSpy, updateSpy, deleteSpy, getOperationOptionsSpy, registerWatcherStub, sandbox;
    let jsonStream;
    let registerWatcherFake;
    let mtstub;
    beforeEach(function () {
      sandbox = sinon.createSandbox();
      mtstub = sinon.stub(MultitenancyService, 'createInstance').callsFake(function (instance_id, options, resourceType) {
        MultitenancyOperatorDummy.createInstanceDummy(instance_id, options, resourceType);
        return Promise.resolve({
          'create': () => {
            MultitenancyOperatorDummy.createDummy();
            return Promise.resolve({});
          },
          'update': opts => {
            MultitenancyOperatorDummy.updateDummy(opts);
            return Promise.resolve({});
          },
          'delete': opts => {
            MultitenancyOperatorDummy.deleteDummy(opts);
            return Promise.resolve({});
          }
        });
      });

      createInstanceSpy = sinon.spy(MultitenancyOperatorDummy, 'createInstanceDummy');
      createSpy = sinon.spy(MultitenancyOperatorDummy, 'createDummy');
      updateSpy = sinon.spy(MultitenancyOperatorDummy, 'updateDummy');
      deleteSpy = sinon.spy(MultitenancyOperatorDummy, 'deleteDummy');
      getOperationOptionsSpy = sinon.spy(MultitenancyOperatorDummy, 'getOperationOptionsDummy');
      jsonStream = new JSONStream();
      registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
    });

    afterEach(function () {
      sandbox.restore();
      createInstanceSpy.restore();
      createSpy.restore();
      updateSpy.restore();
      deleteSpy.restore();
      getOperationOptionsSpy.restore();
      registerWatcherStub.restore();
      mtstub.restore();

    });

    it('Should process create request successfully', () => {
      // const MS = ServiceType.getService(CONST.MULTITENANCY_SERVICE_TYPE.MULTITENANCYSERVICE);
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
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
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createInstanceSpy.firstCall.args[1]).to.eql(options);
          expect(createSpy.callCount).to.equal(1);
          mocks.verify();
        });
    });


    it('Should process update request successfully', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
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
            state: 'update'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createInstanceSpy.firstCall.args[1]).to.eql(options);
          expect(updateSpy.callCount).to.equal(1);
          mocks.verify();
        });

    });
    it('Should process delete request successfully', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
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
            state: 'delete'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createInstanceSpy.firstCall.args[1]).to.eql(options);
          expect(deleteSpy.callCount).to.equal(1);
          mocks.verify();
        });
    });

    it('Should not process request if already being served', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/postgresqlmts/${instance_id}`,
            annotations: {
              lockedByManager: config.broker_ip
            }
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should not process request if processing lock is not acquired', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
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
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 409);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should handle acquire processing lock error gracefully', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
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
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 404);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should not process request if already picked by other process', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };
      const changeObject = {
        object: {
          metadata: {
            name: instance_id,
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/postgresqlmts/${instance_id}`,
            annotations: {
              lockedByManager: '10.12.12.12'
            }
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it('Should gracefully handle errors occured while releasing processing lock', () => {
      const options = {
        plan_id: plan_id,
        service_id: service_id,
        organization_guid: organization_guid,
        space_guid: space_guid,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
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
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value());
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 404);
      const crdJsonDeployment = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, undefined, undefined, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createInstanceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createSpy.callCount).to.equal(1);
          mocks.verify();
        });
    });

  });
});
