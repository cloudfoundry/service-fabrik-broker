'use strict';

const _ = require('lodash');
const JSONStream = require('json-stream');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const config = require('../../common/config');
const CONST = require('../../common/constants');
const eventmesh = require('../../data-access-layer/eventmesh/ApiServerClient');
const apiserver = new eventmesh();
const service_id = '6db542eb-8187-4afc-8a85-e08b4a3cc24e';
const plan_id = '2fcf6682-5a4a-4297-a7cd-a97bbe085b8e';
const instance_id = 'e68446f8-023a-404a-af84-12d1ab4c8ac1';
const space_guid = 'fe171a35-3107-4cee-bc6b-0051617f892e';
const organization_guid = '00060d60-067d-41ee-bd28-3bd34f220036';
const index = mocks.director.networkSegmentIndex;
const deployment_name = mocks.director.deploymentNameByIndex(index);

const jsonWriteDelay = 50;

const PostgresqlOperatorDummy = {
  registerWatcherDummy: () => {},
  createPostgresqlServiceDummy: () => {},
  createDummy: () => {},
  updateDummy: () => {},
  deleteDummy: () => {},
  getOperationOptionsDummy: () => {},
};
const resultOptions = {
  plan_id: plan_id
};
const PostgresqlOperator = proxyquire('../../operators/postgresql-operator/PostgresqlOperator', {
  '../../data-access-layer/eventmesh': {
    'apiServerClient': {
      'getOptions': function (opts) {
        PostgresqlOperatorDummy.getOperationOptionsDummy(opts);
        return Promise.resolve(resultOptions);
      }
    }
  },
  './PostgresqlService': {
    'createPostgresqlService': function (instance_id, options) {
      PostgresqlOperatorDummy.createPostgresqlServiceDummy(instance_id, options);
      return Promise.resolve({
        'create': () => {
          PostgresqlOperatorDummy.createDummy();
          return Promise.resolve({});
        },
        'update': (opts) => {
          PostgresqlOperatorDummy.updateDummy(opts);
          return Promise.resolve({});
        },
        'delete': (opts) => {
          PostgresqlOperatorDummy.deleteDummy(opts);
          return Promise.resolve({});
        },
      });
    }
  }
});

function initDefaultBMTest(jsonStream, sandbox, registerWatcherStub) {
  /* jshint unused:false */
  const bm = new PostgresqlOperator();
  bm.init();
  return Promise.delay(100)
    .then(() => {
      expect(registerWatcherStub.callCount).to.equal(1);
      expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT);
      expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound handleResource');
      expect(registerWatcherStub.firstCall.args[3]).to.eql('state in (in_queue,update,delete)');
      registerWatcherStub.restore();
    });
}

describe('postgresql-operator', function () {
  describe('PostgresqlOperator', function () {
    let createPostgresqlServiceSpy, createSpy, updateSpy, deleteSpy, getOperationOptionsSpy, registerWatcherStub, sandbox;
    let jsonStream;
    let registerWatcherFake;
    beforeEach(function () {
      sandbox = sinon.sandbox.create();
      createPostgresqlServiceSpy = sinon.spy(PostgresqlOperatorDummy, 'createPostgresqlServiceDummy');
      createSpy = sinon.spy(PostgresqlOperatorDummy, 'createDummy');
      updateSpy = sinon.spy(PostgresqlOperatorDummy, 'updateDummy');
      deleteSpy = sinon.spy(PostgresqlOperatorDummy, 'deleteDummy');
      getOperationOptionsSpy = sinon.spy(PostgresqlOperatorDummy, 'getOperationOptionsDummy');
      jsonStream = new JSONStream();
      registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(eventmesh.prototype, 'registerWatcher', registerWatcherFake);
      initDefaultBMTest(jsonStream, sandbox, registerWatcherStub);
    });

    afterEach(function () {
      sandbox.restore();
      createPostgresqlServiceSpy.restore();
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createPostgresqlServiceSpy.firstCall.args[1]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`
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
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createPostgresqlServiceSpy.firstCall.args[1]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`
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
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 2);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createPostgresqlServiceSpy.firstCall.args[1]).to.eql(options);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`,
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
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 409);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 404);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`,
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
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.callCount).to.equal(0);
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
            selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/logicaldbs/${instance_id}`
          },
          spec: {
            options: JSON.stringify(options)
          },
          status: {
            state: 'in_queue'
          }
        }
      };
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value());
      mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB, _.chain(changeObject.object)
        .cloneDeep()
        .merge('metadata', {
          annotations: config.broker_ip
        })
        .value(), 1, undefined, 404);
      const crdJsonDeployment = apiserver.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.LOGICALDB);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, crdJsonDeployment.metadata.name, {}, crdJsonDeployment);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(jsonWriteDelay).then(() => {
          expect(createPostgresqlServiceSpy.firstCall.args[0]).to.eql(instance_id);
          expect(createSpy.callCount).to.equal(1);
          mocks.verify();
        });
    });

  });
});