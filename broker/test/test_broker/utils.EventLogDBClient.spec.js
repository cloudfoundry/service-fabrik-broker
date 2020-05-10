'use strict';

const proxyquire = require('proxyquire');
const pubsub = require('pubsub-js');
const {
  CONST,
  Repository
} = require('@sf/common-utils');

describe('utils', function () {
  /* jshint expr:true */
  describe('EventLogDBClient', function () {
    const EventLogDBClient = proxyquire('../../data-access-layer/event-logger/src/EventLogDBClient', {
      '@sf/app-config': {
        monitoring: {
          events_logged_in_db: 'get_backup_by_guid,update_instance'
        }
      }
    });
    let subscribeStub, saveStub, processAppEventHandler, shutDownHandler;

    before(function () {
      subscribeStub = sinon.stub(pubsub, 'subscribe').callsFake((eventType, handler) => {
        if (eventType === CONST.TOPIC.APP_SHUTTING_DOWN) {
          shutDownHandler = handler;
        } else {
          processAppEventHandler = handler;
        }
        return handler;
      });
      saveStub = sinon.stub(Repository, 'save');
    });
    afterEach(function () {
      subscribeStub.resetHistory();
      saveStub.resetHistory();
    });
    after(function () {
      subscribeStub.restore();
      saveStub.restore();
    });

    it('#initialize', function () {
      const eventLogDBClient = new EventLogDBClient({
        event_type: 'SF.BROKER_EVENT'
      });
      shutDownHandler();
      expect(subscribeStub).to.be.calledTwice;
      expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
    });
    it('#initialize - gracefully handles when input with invalid options', function () {
      const eventLogDBClient = new EventLogDBClient();
      expect(subscribeStub).to.be.calledOnce;
      expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
    });
    it('#initialize - subscribe only once to events', function () {
      const eventLogDBClient = new EventLogDBClient({
        event_type: 'SF.BROKER_EVENT'
      });
      expect(subscribeStub).to.be.calledTwice;
      expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
    });

    describe('#logevent', function () {
      it('ignores invalid events', function () {
        const eventLogDBClient = new EventLogDBClient();
        eventLogDBClient.handleEvent('', {
          event: {}
        });
        shutDownHandler();
        expect(saveStub).not.to.be.called;
      });
      it('does not log events which are not configured', function () {
        const eventLogDBClient = new EventLogDBClient();
        const eventInfo = {
          host: '4c30f022-a041-4100-aa15-0c9979ca7938',
          eventName: 'CF.broker.0.service-fabrik.director.create_instance'
        };
        eventLogDBClient.handleEvent('', {
          event: eventInfo
        });
        expect(saveStub).not.to.be.called;
      });
      it('successfully logs event to DB', function () {

        const eventInfo = {
          host: '4c30f022-a041-4100-aa15-0c9979ca7938',
          eventName: 'CF.broker.0.service-fabrik.director.update_instance',
          metric: 1,
          state: 'critical',
          description: 'Update existing service instance failed. HTTP Status : 200',
          tags: ['update'],
          time: new Date(),
          request: {
            instance_id: '46d34d39-83b1-4b2d-8260-50f2d66a0957',
            plan_id: 'a49cd221-e8c2-4f22-a2a6-366bf00b5c54',
            service_id: '6db542eb-8187-4afc-8a85-e08b4a3cc24e',
            user: {
              name: 'broker'
            }
          },
          response: {
            state: 'failed',
            description: 'Update deployment service-fabrik-1790-46d34d39-83b1-4b2d-8260-50f2d66a0957 failed.'
          }
        };
        const eventLogDBClient = new EventLogDBClient({
          event_type: 'SF.BROKER_EVENT'
        });
        expect(subscribeStub).to.be.calledTwice;
        expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
        processAppEventHandler('', {
          event: eventInfo
        });
        eventInfo.instanceId = '46d34d39-83b1-4b2d-8260-50f2d66a0957';
        eventInfo.eventName = 'update_instance';
        eventInfo.completeEventName = 'CF.broker.0.service-fabrik.director.update_instance';
        expect(saveStub).to.be.calledOnce;
        expect(saveStub.firstCall.args[0]).to.equal(CONST.DB_MODEL.EVENT_DETAIL);
        expect(saveStub.firstCall.args[1]).to.eql(eventInfo);
        expect(saveStub.firstCall.args[2]).to.eql(eventInfo.request.user);
      });
      it('successfully logs event to DB with right instance id picked from response detail of event', function () {
        const eventInfo = {
          host: '4c30f022-a041-4100-aa15-0c9979ca7938',
          eventName: 'CF.broker.0.service-fabrik.get_backup_by_guid',
          metric: 0,
          state: 'ok',
          description: 'Retrieve metadata of a specific backup within the given space succeeded',
          tags: ['backup'],
          time: 1506328365012,
          request: {
            backup_guid: '4ed9bfdb-b8be-404e-8b20-e9b05d80d464',
            space_guid: '8b048b86-fca9-43d0-9858-1330e298603e',
            user: {
              id: '6df59682-99af-4ab3-a688-d813e58c33f6',
              name: 'admin',
              email: 'admin'
            }
          },
          response: {
            service_id: '6db542eb-8187-4afc-8a85-e08b4a3cc24e',
            plan_id: 'a49cd221-e8c2-4f22-a2a6-366bf00b5c54',
            instance_guid: '52c3b43f-8da8-4011-975b-107d2fa63c6c',
            organization_guid: '53e44c7c-73d5-4fbd-b98d-b966c638386f',
            space_guid: '8b048b86-fca9-43d0-9858-1330e298603e',
            username: 'admin',
            operation: 'backup',
            type: 'online',
            backup_guid: '4ed9bfdb-b8be-404e-8b20-e9b05d80d464',
            trigger: 'scheduled',
            state: 'processing',
            started_at: '2017-09-25T08:31:09.436Z',
            finished_at: null
          }
        };
        const eventLogDBClient = new EventLogDBClient({
          event_type: 'SF.BROKER_EVENT'
        });
        expect(subscribeStub).to.be.calledTwice;
        expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
        processAppEventHandler('', {
          event: eventInfo
        });
        eventInfo.instanceId = '52c3b43f-8da8-4011-975b-107d2fa63c6c';
        eventInfo.eventName = 'get_backup_by_guid';
        eventInfo.completeEventName = 'CF.broker.0.service-fabrik.get_backup_by_guid';
        expect(saveStub).to.be.calledOnce;
        expect(saveStub.firstCall.args[0]).to.equal(CONST.DB_MODEL.EVENT_DETAIL);
        expect(saveStub.firstCall.args[1]).to.eql(eventInfo);
        expect(saveStub.firstCall.args[2]).to.eql(eventInfo.request.user);
      });
    });
  });
});
