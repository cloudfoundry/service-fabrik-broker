'use strict';

const Promise = require('bluebird');
const CONST = require('../common/constants');
const eventmesh = require('../eventmesh');
const {
  Etcd3
} = require('etcd3');


describe('eventmesh', () => {
  describe('Etcd3EventMeshServer', () => {
    let sandbox, valueStub, stringStub, jsonStub, putstub, getstub, prefixWatcherStub, keyWatcherStub;
    before(() => {
      sandbox = sinon.sandbox.create();
      valueStub = sandbox.stub();
      stringStub = sandbox.stub();
      jsonStub = sandbox.stub();
      putstub = sandbox.stub(Etcd3.prototype, 'put', () => {
        return {
          value: (val) => Promise.resolve(valueStub(val))
        };
      });
      getstub = sandbox.stub(Etcd3.prototype, 'get', () => {
        return {
          json: () => Promise.resolve(jsonStub()),
          string: () => Promise.resolve(stringStub()),
        };
      });

      prefixWatcherStub = sandbox.stub().returns({
        create: () => Promise.resolve({
          on: () => Promise.resolve('prefixWatcherStubResponse')
        }),
      });
      keyWatcherStub = sandbox.stub().returns({
        create: () => Promise.resolve({
          on: () => Promise.resolve('keyWatcherStubResponse')
        }),
      });
      sandbox.stub(Etcd3.prototype, 'watch', () => {
        return {
          prefix: prefixWatcherStub,
          key: keyWatcherStub
        };
      });
    });

    afterEach(function () {
      valueStub.reset();
      prefixWatcherStub.reset();
      keyWatcherStub.reset();
      putstub.reset();
      getstub.reset();
      jsonStub.reset();
      stringStub.reset();
    });

    after(function () {
      sandbox.restore();
    });

    describe('#registerService', () => {
      it('should register attributes and plans', () => {
        return eventmesh.server.registerService('fakeresourceType', 'fakeserviceId', ['fakeserviceAttributesJsonValue'], ['fakeservicePlansJsonValue'])
          .then(() => {
            /* jshint expr: true */
            expect(putstub.getCall(0).calledWithExactly('services/fakeresourceType/fakeserviceId/attributes')).to.be.true;
            expect(putstub.getCall(1).calledWithExactly('services/fakeresourceType/fakeserviceId/plans')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly(JSON.stringify(['fakeserviceAttributesJsonValue']))).to.be.true;
            expect(valueStub.getCall(1).calledWithExactly(JSON.stringify(['fakeservicePlansJsonValue']))).to.be.true;
          });
      });

      it('should return put response for set plansKey from event mesh server', () => {
        valueStub.onCall(0).returns('eventmesh_put_attributeResponse');
        valueStub.onCall(1).returns('eventmesh_put_planResponse');
        return eventmesh.server.registerService('fakeresourceType', 'fakeserviceId', ['fakeserviceAttributesJsonValue'], ['fakeservicePlansJsonValue'])
          .then((result) => {
            expect(result).to.eql('eventmesh_put_planResponse');
          });
      });
    });

    describe('#getServiceAttributes', () => {
      it('should get service attributes for resource type and serviceid', () => {
        return eventmesh.server.getServiceAttributes('fakeResourceType', 'fakeServiceId')
          .then(() => {
            return expect(getstub.getCall(0).calledWithExactly('services/fakeResourceType/fakeServiceId/attributes')).to.be.true;
          });
      });

      it('should return json response from event mesh server', () => {
        const expected_resp = {
          'data': 'Service Attributes'
        };
        jsonStub.onCall(0).returns(expected_resp);
        return eventmesh.server.getServiceAttributes('fakeResourceType', 'fakeServiceId')
          .then((result) => {
            expect(result).to.eql(expected_resp);
          });
      });
    });

    describe('#getServicePlans', () => {
      it('should get plans for resource type and service id ', () => {
        return eventmesh.server.getServicePlans('fakeResourceType', 'fakeServiceId')
          .then(() => expect(getstub.getCall(0).calledWithExactly('services/fakeResourceType/fakeServiceId/plans')).to.be.true);
      });
      it('should return json response from the event mesh server', () => {
        const expected_resp = {
          'data': 'Service Plans'
        };
        jsonStub.onCall(0).returns(expected_resp);
        return eventmesh.server.getServicePlans('fakeResourceType', 'fakeServiceId')
          .then((result) => {
            expect(result).to.eql(expected_resp);
          });
      });
    });

    describe('#createResource', () => {
      it('should set options, state and lastoperation keys for new resource', () => {
        return eventmesh.server.createResource('fakeResourceType', 'fakeResourceId', 'fakeValue')
          .then(() => {
            /* jshint expr: true */
            expect(putstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/options')).to.be.true;
            expect(putstub.getCall(1).calledWithExactly('deployments/fakeResourceType/fakeResourceId/state')).to.be.true;
            expect(putstub.getCall(2).calledWithExactly('deployments/fakeResourceType/fakeResourceId/lastoperation')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly('fakeValue')).to.be.true;
            expect(valueStub.getCall(1).calledWithExactly(CONST.RESOURCE_STATE.IN_QUEUE)).to.be.true;
            expect(valueStub.getCall(2).calledWithExactly('')).to.be.true;
          });
      });

      it('should return put reponse for setting lastOperation key from the event meshserver', () => {
        valueStub.onCall(0).returns('eventmesh_put_optionResponse');
        valueStub.onCall(1).returns('eventmesh_put_statusResponse');
        valueStub.onCall(2).returns('eventmesh_put_lastOperationResponse');
        return eventmesh.server.createResource('fakeResourceType', 'fakeResourceId', 'fakeValue')
          .then((result) => {
            expect(result).to.eql('eventmesh_put_lastOperationResponse');
          });
      });
    });

    describe('#updateResourceState', () => {
      it('should update resource state with state value', () => {
        return eventmesh.server.updateResourceState('fakeResourceType', 'fakeResourceId', CONST.RESOURCE_STATE.IN_QUEUE)
          .then(() => {
            /* jshint expr: true */
            expect(putstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/state')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly(CONST.RESOURCE_STATE.IN_QUEUE)).to.be.true;
          });
      });
      it('should throw error if the state value is invalid', () => {
        return eventmesh.server.updateResourceState('fakeResourceType', 'fakeResourceId', 'stateValue')
          .catch(e => expect(e.message).to.eql('Could not find state stateValue'));
      });
      it('should return put ResourceState response from the event mesh', () => {
        valueStub.onCall(0).returns('eventmesh_put_stateResponse');
        return eventmesh.server.updateResourceState('fakeResourceType', 'fakeResourceId', CONST.RESOURCE_STATE.IN_QUEUE)
          .then((result) => {
            expect(result).to.eql('eventmesh_put_stateResponse');
          });
      });
    });

    describe('#updateResourceKey', () => {
      it('should update the resouce key with given value', () => {
        return eventmesh.server.updateResourceKey('fakeResourceType', 'fakeResourceId', 'fakekey', 'fakeValue')
          .then(() => {
            /* jshint expr: true */
            expect(putstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakekey')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly('fakeValue')).to.be.true;
          });
      });

      it('should return put ResourceKey response from the event mesh', () => {
        valueStub.onCall(0).returns('eventmesh_put_keyResponse');
        return eventmesh.server.updateResourceKey('fakeResourceType', 'fakeResourceId', 'fakeKey')
          .then((result) => {
            expect(result).to.eql('eventmesh_put_keyResponse');
          });
      });

    });

    describe('#getResourceKeyValue', () => {
      it('should get the resource key', () => {
        return eventmesh.server.getResourceKeyValue('fakeResourceType', 'fakeResourceId', 'fakeKey')
          .then(() => {
            /* jshint expr: true */
            expect(getstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakeKey')).to.be.true;
          });
      });
      it('should return string response form event mesh server', () => {
        const expected_resp = 'Resource key response';
        stringStub.onCall(0).returns(expected_resp);
        return eventmesh.server.getResourceKeyValue('fakeResourceType', 'fakeResourceId', 'fakeKey')
          .then((result) => {
            expect(result).to.eql(expected_resp);
          });
      });
    });

    describe('#getResourceState', () => {
      it('should get the resource state', () => {
        return eventmesh.server.getResourceState('fakeResourceType', 'fakeResourceId')
          .then(() => {
            /* jshint expr: true */
            expect(getstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/state')).to.be.true;
          });
      });
      it('should return string response form event mesh server', () => {
        const expected_resp = 'Resource state response';
        stringStub.onCall(0).returns(expected_resp);
        return eventmesh.server.getResourceState('fakeResourceType', 'fakeResourceId', 'fakeKey')
          .then((result) => {
            expect(result).to.eql(expected_resp);
          });
      });
    });

    describe('#registerWatcher', () => {
      it('should register reccursively on key when isRecursive is true', () => {
        let isRecursive = true;
        return eventmesh.server.registerWatcher('fakeKey', 'fakeCallback', isRecursive)
          .then(() => {
            /* jshint expr: true */
            expect(keyWatcherStub.notCalled).to.be.true;
            expect(prefixWatcherStub.getCall(0).calledWithExactly('fakeKey')).to.be.true;
          });
      });
      it('should register non-reccursively on key when isRecursive is false', () => {
        let isRecursive = false;
        return eventmesh.server.registerWatcher('fakeKey', 'fakeCallback', isRecursive)
          .then(() => {
            /* jshint expr: true */
            expect(keyWatcherStub.getCall(0).calledWithExactly('fakeKey')).to.be.true;
            expect(prefixWatcherStub.notCalled).to.be.true;
          });
      });
      it('should return response of key watcher.on ', () => {
        let isRecursive = false;
        return eventmesh.server.registerWatcher('fakeKey', 'fakeCallback', isRecursive)
          .then((result) => {
            expect(result).to.eql('keyWatcherStubResponse');
          });
      });
      it('should return response of prefix watcher.on ', () => {
        let isRecursive = true;
        return eventmesh.server.registerWatcher('fakeKey', 'fakeCallback', isRecursive)
          .then((result) => {
            expect(result).to.eql('prefixWatcherStubResponse');
          });
      });
    });

    describe('#annotateResource', () => {
      const opts = {
        resourceType: 'fakeResourceType',
        resourceId: 'fakeResourceId',
        annotationName: 'fakeAnnotationName',
        annotationType: 'fakeOperationType',
        annotationId: 'fakeOperationId',
        val: 'fakeVal'
      };
      it('should annotate the resourse with option and state keys', () => {
        return eventmesh.server.annotateResource(opts)
          .then(() => {
            /* jshint expr: true */
            expect(putstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/options')).to.be.true;
            expect(putstub.getCall(1).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/state')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly('fakeVal')).to.be.true;
            expect(valueStub.getCall(1).calledWithExactly(CONST.RESOURCE_STATE.IN_QUEUE)).to.be.true;
          });
      });
      it('should return put reponse for status key from the event mesh server', () => {
        valueStub.onCall(0).returns('eventmesh_put_optionKeyResponse');
        valueStub.onCall(1).returns('eventmesh_put_statusKeyResponse');
        return eventmesh.server.annotateResource(opts)
          .then((result) => {
            expect(result).to.eql('eventmesh_put_statusKeyResponse');
          });
      });
    });

    describe('#updateAnnotationState', () => {
      const opts = {
        resourceType: 'fakeResourceType',
        resourceId: 'fakeResourceId',
        annotationName: 'fakeAnnotationName',
        annotationType: 'fakeOperationType',
        annotationId: 'fakeOperationId',
        stateValue: 'fakeStateValue'
      };
      it('should update the annotation state key', () => {
        return eventmesh.server.updateAnnotationState(opts)
          .then(() => {
            /* jshint expr: true */
            expect(putstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/state')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly('fakeStateValue')).to.be.true;
          });
      });
      it('should return put annotation state response from event mesh server', () => {
        valueStub.onCall(0).returns('eventmesh_put_annotationStateKeyResponse');
        return eventmesh.server.updateAnnotationState(opts)
          .then((result) => {
            expect(result).to.eql('eventmesh_put_annotationStateKeyResponse');
          });
      });
    });

    describe('#updateAnnotationKey', () => {
      const opts = {
        resourceType: 'fakeResourceType',
        resourceId: 'fakeResourceId',
        annotationName: 'fakeAnnotationName',
        annotationType: 'fakeOperationType',
        annotationId: 'fakeOperationId',
        key: 'fakeKey',
        value: 'fakeValue'
      };
      it('should update the annotation key specified', () => {
        return eventmesh.server.updateAnnotationKey(opts)
          .then(() => {
            /* jshint expr: true */
            expect(putstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/fakeKey')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly('fakeValue')).to.be.true;
          });
      });
      it('should return put annotation key response from event mesh server', () => {
        valueStub.onCall(0).returns('eventmesh_put_annotationKeyResponse');
        return eventmesh.server.updateAnnotationKey(opts)
          .then((result) => {
            expect(result).to.eql('eventmesh_put_annotationKeyResponse');
          });
      });
    });

    describe('#getAnnotationKey', () => {
      const opts = {
        resourceType: 'fakeResourceType',
        resourceId: 'fakeResourceId',
        annotationName: 'fakeAnnotationName',
        annotationType: 'fakeOperationType',
        annotationId: 'fakeOperationId',
        key: 'fakeKey'
      };
      it('should get the annotation key', () => {
        return eventmesh.server.getAnnotationKey(opts)
          .then(() => {
            /* jshint expr: true */
            expect(getstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/fakeKey')).to.be.true;
          });
      });
      it('should return string response form event mesh server', () => {
        const expected_resp = 'Annotation key response';
        stringStub.onCall(0).returns(expected_resp);
        return eventmesh.server.getAnnotationKey(opts)
          .then((result) => {
            expect(result).to.eql(expected_resp);
          });
      });
    });

    describe('#getAnnotationState', () => {
      const opts = {
        resourceType: 'fakeResourceType',
        resourceId: 'fakeResourceId',
        annotationName: 'fakeAnnotationName',
        annotationType: 'fakeOperationType',
        annotationId: 'fakeOperationId',
      };
      it('should get the annotation state', () => {
        return eventmesh.server.getAnnotationState(opts)
          .then(() => {
            /* jshint expr: true */
            expect(getstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/state')).to.be.true;
          });
      });
      it('should return string response form event mesh server', () => {
        const expected_resp = 'Annotation state response';
        stringStub.onCall(0).returns(expected_resp);
        return eventmesh.server.getAnnotationState(opts)
          .then((result) => {
            expect(result).to.eql(expected_resp);
          });
      });
    });

  });
});