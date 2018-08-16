'use strict';

const JSONStream = require('json-stream');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const config = require('../../common/config');
const CONST = require('../../common/constants');
const catalog = require('../../common/models/catalog');
const eventmesh = require('../../data-access-layer/eventmesh/ApiServerClient');
const apiserver = new eventmesh();

const service_id = '3c266123-8e6e-4034-a2aa-e48e13fbf893';
const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
const space_guid = 'fe171a35-3107-4cee-bc6b-0051617f892e';
const organization_guid = '00060d60-067d-41ee-bd28-3bd34f220036';

const BOSHManagerDummy = {
  registerWatcherDummy: () => {},
  createDirectorServiceDummy: () => {},
  createDummy: () => {},
  updateDummy: () => {},
  deleteDummy: () => {},
  getOperationOptionsDummy: () => {},
};
const resultOptions = {
  plan_id: plan_id
};
const BOSHManager = proxyquire('../../managers/bosh-manager/BOSHManager', {
  '../../data-access-layer/eventmesh': {
    'apiServerClient': {
      'getOptions': function (opts) {
        BOSHManagerDummy.getOperationOptionsDummy(opts);
        return Promise.resolve(resultOptions);
      }
    }
  },
  './DirectorService': {
    'createDirectorService': function (instance_id, options) {
      BOSHManagerDummy.createDirectorServiceDummy(instance_id, options);
      return Promise.resolve({
        'create': (opts) => {
          BOSHManagerDummy.createDummy(opts);
          return Promise.resolve({});
        },
        'update': (opts) => {
          BOSHManagerDummy.updateDummy(opts);
          return Promise.resolve({});
        },
        'delete': (opts) => {
          BOSHManagerDummy.deleteDummy(opts);
          return Promise.resolve({});
        },
      });
    }
  }
});

function initDefaultBMTest(jsonStream, sandbox, registerWatcherStub) {
  const registerWatcherFake = function (resourceGroup, resourceType, callback) {
    return Promise.try(() => {
      jsonStream.on('data', callback);
      return jsonStream;
    });
  };
  registerWatcherStub = sandbox.stub(eventmesh.prototype, 'registerWatcher', registerWatcherFake);
  /* jshint unused:false */
  const bm = new BOSHManager();
  bm.init();
  return Promise.delay(100)
    .then(() => {
      expect(registerWatcherStub.callCount).to.equal(1);
      expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT);
      expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound handleResource');
      expect(registerWatcherStub.firstCall.args[3]).to.eql('state in (in_queue,update,delete)');
      registerWatcherStub.restore();
    });
}

describe('managers', function () {
  describe('BOSHManager', function () {
    let createDirectorServiceSpy, createSpy, updateSpy, deleteSpy, getOperationOptionsSpy, registerWatcherStub, sandbox;
    before(function () {
      sandbox = sinon.sandbox.create();
      createDirectorServiceSpy = sinon.spy(BOSHManagerDummy, 'createDirectorServiceDummy');
      createSpy = sinon.spy(BOSHManagerDummy, 'createDummy');
      updateSpy = sinon.spy(BOSHManagerDummy, 'updateDummy');
      deleteSpy = sinon.spy(BOSHManagerDummy, 'deleteDummy');
      getOperationOptionsSpy = sinon.spy(BOSHManagerDummy, 'getOperationOptionsDummy');
    });

    afterEach(function () {
      createDirectorServiceSpy.reset();
      createSpy.reset();
      updateSpy.reset();
      deleteSpy.reset();
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex('deployment', 'director', {
        metadata: {
          annotations: config.broker_ip
        }
      }, 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);

      const jsonStream = new JSONStream();
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createDirectorServiceSpy.firstCall.args[1]).to.eql(options);
          expect(createSpy.callCount).to.equal(1);
          expect(createSpy.firstCall.args[0]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'update'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex('deployment', 'director', {
        metadata: {
          annotations: config.broker_ip
        }
      }, 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      const jsonStream = new JSONStream();
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(1);
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createDirectorServiceSpy.firstCall.args[1]).to.eql(options);
          expect(updateSpy.callCount).to.equal(1);
          expect(updateSpy.firstCall.args[0]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'delete'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex('deployment', 'director', {
        metadata: {
          annotations: config.broker_ip
        }
      }, 2);
      const jsonStream = new JSONStream();
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(1);
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createDirectorServiceSpy.firstCall.args[1]).to.eql(options);
          expect(deleteSpy.callCount).to.equal(1);
          expect(deleteSpy.firstCall.args[0]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
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
      const jsonStream = new JSONStream();
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex('deployment', 'director', {
        metadata: {
          annotations: ''
        }
      }, 1, undefined, 409);
      const jsonStream = new JSONStream();
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex('deployment', 'director', {
        metadata: {
          annotations: ''
        }
      }, 1, undefined, 404);
      const jsonStream = new JSONStream();
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
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
      const jsonStream = new JSONStream();
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.callCount).to.equal(0);
          expect(createSpy.callCount).to.equal(0);
          mocks.verify();
        });
    });

    it.only('Should gracefully handle errors occured while releasing processing lock', () => {
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex('deployment', 'director', {
        metadata: {
          annotations: config.broker_ip
        }
      });
      mocks.apiServerEventMesh.nockPatchResourceRegex('deployment', 'director', {
        metadata: {
          annotations: config.broker_ip
        }
      }, 1, undefined, 404);
      const jsonStream = new JSONStream();
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(createDirectorServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createSpy.callCount).to.equal(1);
          expect(createSpy.firstCall.args[0]).to.eql(options);
          mocks.verify();
        });
    });

  });
});