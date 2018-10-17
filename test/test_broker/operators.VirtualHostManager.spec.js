'use strict';

const _ = require('lodash');
const JSONStream = require('json-stream');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const config = require('../../common/config');
const CONST = require('../../common/constants');
const eventmesh = require('../../data-access-layer/eventmesh/ApiServerClient');
const apiserver = new eventmesh();
const errors = require('../../common/errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;

const service_id = '3c266123-8e6e-4034-a2aa-e48e13fbf893';
const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
const parent_instance_id = '312eb96a-5fba-4f62-be43-053c8624cd84';
const space_guid = 'fe171a35-3107-4cee-bc6b-0051617f892e';
const organization_guid = '00060d60-067d-41ee-bd28-3bd34f220036';
let parameters = {
  dedicated_rabbitmq_instance: 'rmq'
};

const VirtualHostOperatorDummy = {
  registerWatcherDummy: () => {},
  createVirtualHostServiceDummy: () => {},
  createDummy: () => {},
  updateDummy: () => {},
  deleteDummy: () => {},
  getOperationOptionsDummy: () => {},
};
const resultOptions = {
  plan_id: plan_id
};
const VirtualHostOperator = proxyquire('../../operators/virtualhost-operator/VirtualHostOperator', {
  '../../data-access-layer/eventmesh': {
    'apiServerClient': {
      'getOptions': function (opts) {
        VirtualHostOperatorDummy.getOperationOptionsDummy(opts);
        return Promise.resolve(resultOptions);
      },
      'updateResource': function (opts) {
        VirtualHostOperatorDummy.updateDummy(opts);
        return Promise.resolve(resultOptions);
      },
      'deleteResource': function (opts) {
        VirtualHostOperatorDummy.deleteDummy(opts);
        return Promise.resolve(resultOptions);
      }
    }
  },
  './VirtualHostService': {
    'createVirtualHostService': function (instance_id, options) {
      VirtualHostOperatorDummy.createVirtualHostServiceDummy(instance_id, options);
      return Promise.resolve({
        'create': () => {
          VirtualHostOperatorDummy.createDummy();
          if (parameters !== null) {
            return Promise.resolve({});
          } else {
            throw new ServiceInstanceNotFound(parent_instance_id);
          }
        },
        'update': () => {
          VirtualHostOperatorDummy.updateDummy();
          return Promise.resolve({});
        },
        'delete': () => {
          VirtualHostOperatorDummy.deleteDummy();
          return Promise.resolve({});
        },
      });
    }
  }
});
const jsonWriteDelay = 50;

function initDefaultVMTest(jsonStream, sandbox, registerWatcherStub) {
  /* jshint unused:false */
  const vm = new VirtualHostOperator();
  vm.init();
  return Promise.delay(100)
    .then(() => {
      expect(registerWatcherStub.callCount).to.equal(1);
      expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT);
      expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound handleResource');
      expect(registerWatcherStub.firstCall.args[3]).to.eql('state in (in_queue,update,delete)');
      registerWatcherStub.restore();
    });
}

describe('operators', function () {
  describe('VirtualHostOperator', function () {
    let createVirtualHostServiceSpy, createSpy, updateSpy, deleteSpy, getOperationOptionsSpy, registerWatcherStub, sandbox;
    let jsonStream;
    let registerWatcherFake;
    beforeEach(function () {
      sandbox = sinon.sandbox.create();
      createVirtualHostServiceSpy = sinon.spy(VirtualHostOperatorDummy, 'createVirtualHostServiceDummy');
      createSpy = sinon.spy(VirtualHostOperatorDummy, 'createDummy');
      updateSpy = sinon.spy(VirtualHostOperatorDummy, 'updateDummy');
      deleteSpy = sinon.spy(VirtualHostOperatorDummy, 'deleteDummy');
      getOperationOptionsSpy = sinon.spy(VirtualHostOperatorDummy, 'getOperationOptionsDummy');
      jsonStream = new JSONStream();
      registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(eventmesh.prototype, 'registerWatcher', registerWatcherFake);
      initDefaultVMTest(jsonStream, sandbox, registerWatcherStub);
    });

    afterEach(function () {
      sandbox.restore();
      createVirtualHostServiceSpy.restore();
      createSpy.restore();
      updateSpy.restore();
      deleteSpy.restore();
      getOperationOptionsSpy.restore();
      registerWatcherStub.restore();
    });

    it('Should process create request successfully', () => {
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createVirtualHostServiceSpy.firstCall.args[1]).to.eql(options);
          expect(createSpy.callCount).to.equal(1);
          mocks.verify();
        });
    });

    it('Should process any error in create request successfully', () => {
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      parameters = null;
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createVirtualHostServiceSpy.firstCall.args[1]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'update'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.callCount).to.equal(1);
          expect(createVirtualHostServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createVirtualHostServiceSpy.firstCall.args[1]).to.eql(options);
          expect(updateSpy.callCount).to.equal(2);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'delete'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.callCount).to.equal(1);
          expect(createVirtualHostServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createVirtualHostServiceSpy.firstCall.args[1]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`,
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
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 409);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 404);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`,
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
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/virtualhosts/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      parameters = {
        dedicated_rabbitmq_instance: 'rmq'
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value());
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 404);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createVirtualHostServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createSpy.callCount).to.equal(1);
          mocks.verify();
        });
    });

  });
});