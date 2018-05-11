'use strict';
const EventMeshServer = require('../eventmesh/EventMeshServer');
const CONST = require('../common/constants');
const errors = require('../common/errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

describe('eventmesh', () => {
  describe('EventMeshServer', () => {
    let eventmesh = new EventMeshServer();

    describe('#checkValidState', () => {
      it('should throw error if state is invalid', () => {
        return eventmesh.checkValidState()
          .catch(e => expect(e.message).to.eql('Could not find state undefined'));
      });
      it('should return if state is valid', () => {
        return eventmesh.checkValidState(CONST.RESOURCE_STATE.IN_QUEUE)
          .catch(() => {
            throw new Error('No exception expected');
          });
      });
    });

    describe('#getServiceFolderName', () => {
      it('should return the key name for services', () => {
        expect(eventmesh.getServiceFolderName('foo', 'bar')).to.eql('services/foo/bar');
      });
    });

    describe('#getResourceFolderName', () => {
      it('should return the key name for resources', () => {
        expect(eventmesh.getResourceFolderName('foo', 'bar')).to.eql('deployments/foo/bar');
      });
    });

    describe('#getAnnotationFolderName', () => {
      it('should return the key name for annotation', () => {
        expect(eventmesh.getAnnotationFolderName('Lorem', 'ipsum', 'dolor', 'sit', 'amet')).to.eql('deployments/Lorem/ipsum/dolor/sit/amet');
      });
    });

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