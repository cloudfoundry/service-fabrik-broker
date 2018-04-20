'use strict';

const Promise = require('bluebird');
const CONST = require('../lib/constants');
const eventmesh = require('../lib/eventmesh');

const {
  Etcd3
} = require('etcd3');


describe('eventmesh', () => {
  describe('Etcd3EventMeshServer', () => {
    let sandbox, valueStub, prefixWatcherStub, keyWatcherStub;
    sandbox = sinon.sandbox.create();
    valueStub = sandbox.stub();
    sandbox.stub(Etcd3.prototype, 'watch', () => {
      return {
        prefix: prefixWatcherStub,
        key: keyWatcherStub
      };
    });
    let putstub = sandbox.stub(Etcd3.prototype, 'put', () => {
      return {
        value: (val) => Promise.resolve(valueStub(val))
      };
    });
    let getstub = sandbox.stub(Etcd3.prototype, 'get', () => {
      return {
        json: () => Promise.resolve(['dummy json']),
        string: () => Promise.resolve('dummy string'),
      };
    });

    beforeEach(() => {
      prefixWatcherStub = sandbox.stub().returns({
        create: () => Promise.resolve({
          on: () => Promise.resolve('')
        }),
      });
      keyWatcherStub = sandbox.stub().returns({
        create: () => Promise.resolve({
          on: () => Promise.resolve('')
        }),
      });
    });

    afterEach(function () {
      valueStub.reset();
      prefixWatcherStub.reset();
      keyWatcherStub.reset();
      putstub.reset();
      getstub.reset();
    });

    describe('#registerService', () => {
      it('should register attributes and plans', () => {
        return eventmesh.server.registerService('fakeresourceType', 'fakeserviceId', ['fakeserviceAttributesJsonValue'], ['fakeservicePlansJsonValue'])
          .then(() => {
            expect(putstub.args[0][0]).to.equal('services/fakeresourceType/fakeserviceId/attributes');
            expect(putstub.args[1][0]).to.equal('services/fakeresourceType/fakeserviceId/plans');
            expect(valueStub.args[0][0]).to.equal(JSON.stringify(['fakeserviceAttributesJsonValue']));
            expect(valueStub.args[1][0]).to.equal(JSON.stringify(['fakeservicePlansJsonValue']));
          });
      });
    });

    describe('#getServiceAttributes', () => {
      it('should get service attributes for resource type and serviceid', () => {
        return eventmesh.server.getServiceAttributes('fakeResourceType', 'fakeServiceId')
          .then(() => expect(getstub.args[0][0]).to.equal('services/fakeResourceType/fakeServiceId/attributes'));
      });
    });

    describe('#getServicePlans', () => {
      it('should get plans for resource type and service id ', () => {
        return eventmesh.server.getServicePlans('fakeResourceType', 'fakeServiceId')
          .then(() => expect(getstub.args[0][0]).to.equal('services/fakeResourceType/fakeServiceId/plans'));
      });
    });

    describe('#createResource', () => {
      it('should set options, state and lastoperation keys for new resource', () => {
        return eventmesh.server.createResource('fakeResourceType', 'fakeResourceId', 'fakeValue')
          .then(() => {
            expect(putstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/options');
            expect(putstub.args[1][0]).to.equal('deployments/fakeResourceType/fakeResourceId/state');
            expect(putstub.args[2][0]).to.equal('deployments/fakeResourceType/fakeResourceId/lastoperation');
            expect(valueStub.args[0][0]).to.equal('fakeValue');
            expect(valueStub.args[1][0]).to.equal(CONST.RESOURCE_STATE.IN_QUEUE);
            expect(valueStub.args[2][0]).to.equal('');
          });
      });
    });

    describe('#updateResourceState', () => {
      it('should update resource state with state value', () => {
        return eventmesh.server.updateResourceState('fakeResourceType', 'fakeResourceId', 'stateValue')
          .then(() => {
            expect(putstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/state');
            expect(valueStub.args[0][0]).to.equal('stateValue');
          });
      });
    });

    describe('#updateResourceKey', () => {
      it('should update the resouce key with given value', () => {
        return eventmesh.server.updateResourceKey('fakeResourceType', 'fakeResourceId', 'fakekey', 'fakeValue')
          .then(
            () => {
              expect(putstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakekey');
              expect(valueStub.args[0][0]).to.equal('fakeValue');
            }
          );
      });
    });

    describe('#getResourceKey', () => {
      it('should get the resource key', () => {
        return eventmesh.server.getResourceKey('fakeResourceType', 'fakeResourceId', 'fakeKey')
          .then(() => {
            expect(getstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakeKey');
          });
      });
    });

    describe('#getResourceState', () => {
      it('should get the resource state', () => {
        return eventmesh.server.getResourceState('fakeResourceType', 'fakeResourceId')
          .then(() => {
            expect(getstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/state');
          });
      });
    });

    describe('#registerWatcher', () => {
      it('should register reccursively on key when isRecursive is true', () => {
        let isRecursive = true;
        return eventmesh.server.registerWatcher('fakeKey', 'fakeCallback', isRecursive)
          .then(() => {
            expect(keyWatcherStub.args[0]).to.equal(undefined);
            expect(prefixWatcherStub.args[0][0]).to.equal('fakeKey');
          });
      });
      it('should register non-reccursively on key when isRecursive is false', () => {
        let isRecursive = false;
        return eventmesh.server.registerWatcher('fakeKey', 'fakeCallback', isRecursive)
          .then(() => {
            expect(keyWatcherStub.args[0][0]).to.equal('fakeKey');
            expect(prefixWatcherStub.args[0]).to.equal(undefined);
          });
      });
    });

    describe('#annotateResource', () => {
      it('should annotate the resourse with option and state keys', () => {
        return eventmesh.server.annotateResource('fakeResourceType', 'fakeResourceId', 'fakeAnnotationName', 'fakeOperationType', 'fakeOperationId', 'fakeVal')
          .then(() => {
            expect(putstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/options');
            expect(putstub.args[1][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/state');
            expect(valueStub.args[0][0]).to.equal('fakeVal');
            expect(valueStub.args[1][0]).to.equal(CONST.RESOURCE_STATE.IN_QUEUE);
          });
      });
    });

    describe('#updateAnnotationState', () => {
      it('should update the annotation state key', () => {
        return eventmesh.server.updateAnnotationState('fakeResourceType', 'fakeResourceId', 'fakeAnnotationName', 'fakeOperationType', 'fakeOperationId', 'fakeStateValue')
          .then(() => {
            expect(putstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/state');
            expect(valueStub.args[0][0]).to.equal('fakeStateValue');
          });
      });
    });

    describe('#updateAnnotationKey', () => {
      it('should update the annotation key specified', () => {
        return eventmesh.server.updateAnnotationKey('fakeResourceType', 'fakeResourceId', 'fakeAnnotationName', 'fakeOperationType', 'fakeOperationId', 'fakeKey', 'fakeValue')
          .then(() => {
            expect(putstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/fakeKey');
            expect(valueStub.args[0][0]).to.equal('fakeValue');
          });
      });
    });

    describe('#getAnnotationKey', () => {
      it('should get the annotation key', () => {
        return eventmesh.server.getAnnotationKey('fakeResourceType', 'fakeResourceId', 'fakeAnnotationName', 'fakeOperationType', 'fakeOperationId', 'fakeKey')
          .then(() => {
            expect(getstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/fakeKey');
          });
      });
    });

    describe('#getAnnotationState', () => {
      it('should get the annotation state', () => {
        return eventmesh.server.getAnnotationState('fakeResourceType', 'fakeResourceId', 'fakeAnnotationName', 'fakeOperationType', 'fakeOperationId')
          .then(() => {
            expect(getstub.args[0][0]).to.equal('deployments/fakeResourceType/fakeResourceId/fakeAnnotationName/fakeOperationType/fakeOperationId/state');
          });
      });
    });

  });
});