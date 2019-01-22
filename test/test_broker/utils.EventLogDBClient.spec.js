'use strict';

const proxyquire = require('proxyquire');
const pubsub = require('pubsub-js');
const Repository = require('../../common/db').Repository;
const CONST = require('../../common/constants');
const jwt = require('../../broker/lib/jwt');

describe('utils', function () {
  /* jshint expr:true */
  describe('EventLogDBClient', function () {
    const EventLogDBClient = proxyquire('../../common/utils/EventLogDBClient', {
      '../config': {
        monitoring: {
          events_logged_in_db: 'get_backup_by_guid,update_instance'
        }
      }
    });
    let subscribeStub, saveStub, processAppEventHandler, initializeHandler, shutDownHandler;

    before(function () {
      subscribeStub = sinon.stub(pubsub, 'subscribe').callsFake((eventType, handler) => {
        if (eventType === CONST.TOPIC.MONGO_OPERATIONAL) {
          initializeHandler = handler;
        } else if (eventType === CONST.TOPIC.APP_SHUTTING_DOWN) {
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
      initializeHandler();
      shutDownHandler();
      expect(subscribeStub).to.be.calledThrice;
      expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
    });
    it('#initialize - gracefully handles when input with invalid options', function () {
      const eventLogDBClient = new EventLogDBClient();
      initializeHandler();
      expect(subscribeStub).to.be.calledTwice;
      expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
    });
    it('#initialize - subscribe only once to events', function () {
      const eventLogDBClient = new EventLogDBClient({
        event_type: 'SF.BROKER_EVENT'
      });
      initializeHandler();
      initializeHandler();
      expect(subscribeStub).to.be.calledThrice;
      expect(eventLogDBClient.eventsToBeLoggedInDB.length).to.equal(2);
    });

    describe('#logevent', function () {
      it('ignores invalid events', function () {
        const eventLogDBClient = new EventLogDBClient();
        initializeHandler();
        eventLogDBClient.handleEvent('', {
          event: {}
        });
        shutDownHandler();
        expect(saveStub).not.to.be.called;
      });
      it('does not log events which are not configured', function () {
        const eventLogDBClient = new EventLogDBClient();
        initializeHandler();
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
        const operation = {
          aud: 'https://management.core.windows.net/',
          iss: 'https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/',
          iat: 1462553269,
          nbf: 1462553269,
          exp: 1462557169,
          appid: 'b9e6e07b-c43e-4731-85ca-9817892724cd',
          appidacr: '1',
          idp: 'https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/',
          oid: '4e043f86-b33d-4c3b-8c56-5c75928a370e',
          sub: '4e043f86-b33d-4c3b-8c56-5c75928a370e',
          tid: '72f988bf-86f1-41af-91ab-2d7cd011db47',
          ver: '1.0'
        };
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
            operation: jwt.sign(operation, 'secret'),
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
        initializeHandler();
        expect(subscribeStub).to.be.calledThrice;
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
        initializeHandler();
        expect(subscribeStub).to.be.calledThrice;
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