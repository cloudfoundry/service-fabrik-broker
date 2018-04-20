'use strict';
const EventMeshServer = require('../lib/eventmesh/EventMeshServer');
const errors = require('../lib/errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

describe('eventmesh', () => {
  describe('EventMeshServer', () => {
    let eventmesh = new EventMeshServer();

    describe('#registerService', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.registerService).to.throw(NotImplementedBySubclass);
        expect(eventmesh.registerService).to.throw('registerService');
      });
    });

    describe('#getServiceAttributes', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.getServiceAttributes).to.throw(NotImplementedBySubclass);
        expect(eventmesh.getServiceAttributes).to.throw('getServiceAttributes');
      });
    });

    describe('#getServicePlans', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.getServicePlans).to.throw(NotImplementedBySubclass);
        expect(eventmesh.getServicePlans).to.throw('getServicePlans');
      });
    });

    describe('#createResource', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.createResource).to.throw(NotImplementedBySubclass);
        expect(eventmesh.createResource).to.throw('createResource');
      });
    });

    describe('#updateResourceState', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.updateResourceState).to.throw(NotImplementedBySubclass);
        expect(eventmesh.updateResourceState).to.throw('updateResourceState');
      });
    });

    describe('#updateResourceKey', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.updateResourceKey).to.throw(NotImplementedBySubclass);
        expect(eventmesh.updateResourceKey).to.throw('updateResourceKey');
      });
    });

    describe('#getResourceKey', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.getResourceKey).to.throw(NotImplementedBySubclass);
        expect(eventmesh.getResourceKey).to.throw('getResourceKey');
      });
    });

    describe('#getResourceState', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.getResourceState).to.throw(NotImplementedBySubclass);
        expect(eventmesh.getResourceState).to.throw('getResourceState');
      });
    });

    describe('#registerWatcher', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.registerWatcher).to.throw(NotImplementedBySubclass);
        expect(eventmesh.registerWatcher).to.throw('registerWatcher');
      });
    });

    describe('#annotateResource', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.annotateResource).to.throw(NotImplementedBySubclass);
        expect(eventmesh.annotateResource).to.throw('annotateResource');
      });
    });

    describe('#updateAnnotationState', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.updateAnnotationState).to.throw(NotImplementedBySubclass);
        expect(eventmesh.updateAnnotationState).to.throw('updateAnnotationState');
      });
    });

    describe('#updateAnnotationKey', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.updateAnnotationKey).to.throw(NotImplementedBySubclass);
        expect(eventmesh.updateAnnotationKey).to.throw('updateAnnotationKey');
      });
    });

    describe('#getAnnotationKey', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.getAnnotationKey).to.throw(NotImplementedBySubclass);
        expect(eventmesh.getAnnotationKey).to.throw('getAnnotationKey');
      });
    });

    describe('#getAnnotationState', () => {
      it('should thow error if not implemented by subclass', () => {
        expect(eventmesh.getAnnotationState).to.throw(NotImplementedBySubclass);
        expect(eventmesh.getAnnotationState).to.throw('getAnnotationState');
      });
    });

  });
});