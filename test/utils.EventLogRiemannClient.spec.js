'use strict';

const proxyquire = require('proxyquire');
const config = require('../broker/lib').config;
const _ = require('lodash');

const pubSubStub = {
  publish: () => undefined,
  subscribe: () => undefined
};

const riemanJSStub = {
  send: () => true,
  /* jshint unused:false */
  Event: (event) => true
};
const RiemannClient = proxyquire('../common/utils/EventLogRiemannClient', {
  riemannjs: {
    createClient: function () {
      return {
        on() {
          return;
        },
        disconnect() {
          return;
        },
        Event(event) {
          return riemanJSStub.Event(event);
        },
        send() {
          return riemanJSStub.send();
        }
      };
    }
  },
  'pubsub-js': {
    subscribe: function (eventType, callBack) {
      return pubSubStub.subscribe(eventType, callBack);
    }
  }
});

describe('utils', function () {
  /* jshint expr:true */
  describe('EventLogRiemannClient', function () {
    let pubSubSpy, riemanSendSpy, riemanEventSpy;

    beforeEach(function () {
      pubSubSpy = sinon.stub(pubSubStub, 'subscribe');
      riemanSendSpy = sinon.stub(riemanJSStub, 'send');
      riemanEventSpy = sinon.stub(riemanJSStub, 'Event');
      pubSubSpy.returns(true);
      riemanSendSpy.returns(true);
      riemanEventSpy.returns(true);
    });

    afterEach(function () {
      pubSubSpy.restore();
      riemanSendSpy.restore();
      riemanEventSpy.restore();
    });

    describe('create', function () {
      it('should create Riemann Client Successfully and subscribe to the input event type', function () {
        const riemannOptions = _
          .chain({})
          .assign(config.riemann)
          .set('event_type', config.internal.event_type)
          .value();
        const riemannClient = new RiemannClient(riemannOptions);
        expect(pubSubSpy).to.be.called;
        const eventType = pubSubSpy.firstCall.args[0];
        expect(riemannClient).to.be.an('object');
        expect(riemannClient.isInitialized).to.eql(false);
        expect(eventType).to.eql(config.internal.event_type);
      });
    });
    describe('send', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      const riemannClient = new RiemannClient(riemannOptions);
      riemannClient.isInitialized = true;

      it('should log event successfully to Riemann with response details', function () {
        const event = {
          host: 'INLN50932351A',
          eventName: 'CF.servicefabrik.broker_catalog',
          metric: 0,
          state: 'ok',
          description: 'Get broker service catalog succeeded',
          tags: ['catalog'],
          time: 1483353454485,
          request: {
            user: {
              name: 'broker'
            }
          },
          response: {}
        };
        const expectedFirstResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('service', event.eventName)
          .set('host', _.get(config, 'riemann.prefix', 'CF'))
          .set('attributes', [{
            key: 'request',
            value: (typeof event.request === 'object' ? JSON.stringify(event.request) : event.request)
          }, {
            key: 'response',
            value: (typeof event.response === 'object' ? JSON.stringify(event.response) : event.response)
          }])
          .value();
        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: true
          }
        });
        expect(riemanSendSpy).to.be.calledOnce;
        expect(riemanEventSpy).to.be.calledOnce;
        const firstResponse = riemanEventSpy.firstCall.args[0];
        expect(firstResponse).to.be.an('object');
        expect(firstResponse).to.eql(expectedFirstResultObject);
      });

      it('should log 2 events successfully to Riemann with response details', function () {
        const event = {
          host: 'INLN50932351A',
          eventName: 'CF.broker.0.service-fabrik.director.create_instance ',
          metric: 0,
          state: 'ok',
          description: 'Create a new service instance',
          tags: ['create'],
          time: 1483353454485,
          request: {
            user: {
              name: 'broker'
            },
            instance_id: 'fe27a9ea-0e93-485a-86f2-600aa725fc88'
          },
          response: {}
        };
        const expectedFirstResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('service', event.eventName)
          .set('host', _.get(config, 'riemann.prefix', 'CF'))
          .set('attributes', [{
            key: 'request',
            value: (typeof event.request === 'object' ? JSON.stringify(event.request) : event.request)
          }, {
            key: 'response',
            value: (typeof event.response === 'object' ? JSON.stringify(event.response) : event.response)
          }])
          .value();
        const expectedSecondResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('service', `${event.eventName}.instance_id.fe27a9ea-0e93-485a-86f2-600aa725fc88`)
          .set('host', _.get(config, 'riemann.prefix', 'CF'))
          .set('attributes', [{
            key: 'request',
            value: (typeof event.request === 'object' ? JSON.stringify(event.request) : event.request)
          }, {
            key: 'response',
            value: (typeof event.response === 'object' ? JSON.stringify(event.response) : event.response)
          }])
          .value();

        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: true
          }
        });
        expect(riemanSendSpy).to.be.calledTwice;
        expect(riemanEventSpy).to.be.calledTwice;
        const firstResponse = riemanEventSpy.firstCall.args[0];
        expect(firstResponse).to.be.an('object');
        expect(firstResponse).to.eql(expectedFirstResultObject);
        const secondResponse = riemanEventSpy.secondCall.args[0];
        expect(secondResponse).to.be.an('object');
        expect(secondResponse).to.eql(expectedSecondResultObject);
      });

      it('should not log any event in case of bad request', function () {
        const event = {
          host: 'INLN50932351A',
          eventName: 'CF.broker.0.service-fabrik.director.update_instance ',
          metric: 1,
          state: 'critical',
          description: 'Update existing service instance failed. HTTP Status : 400',
          tags: ['update'],
          time: 1483353454485,
          request: {
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
            plan_id: 'e86e2cf2-569a-11e7-a2e3-02a8da424bc3',
            previous_values: {
              plan_id: 'bba8beae-5699-11e7-b35c-02a8da424bc3',
              service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
              organization_id: '5cfa2dad-1401-4fbd-9608-806070bbaf11',
              space_id: '8ae0a163-f45c-4097-9aa7-bd79fafd4681'
            },
            context: {
              platform: 'cloudfoundry',
              organization_guid: '5cfa2dad-1401-4fbd-9608-806070bbaf11',
              space_guid: '8ae0a163-f45c-4097-9aa7-bd79fafd4681'
            },
            accepts_incomplete: true,
            instance_id: '10eb2660-d432-4cd4-a23c-469e02b6fa7c',
            user: {
              name: 'broker'
            }
          },
          response: {
            status: 400,
            message: 'Update to plan \'v1.0-xsmall\' is not possible'
          }
        };
        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: true
          }
        });
        expect(riemanEventSpy).not.to.have.been.called;
        expect(riemanSendSpy).not.to.have.been.called;
      });

    });

    describe('sendAfterConnectionReset', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      let rc = new RiemannClient(riemannOptions);
      beforeEach(function () {
        rc.disconnect();
      });

      it('should log event successfully to Riemann even after connection reset (omit response details)', function () {
        const event = {
          host: 'INLN50932351A',
          eventName: 'CF.servicefabrik.broker_catalog',
          metric: 0,
          state: 'ok',
          description: 'Get broker service catalog succeeded',
          tags: ['catalog'],
          time: 1483353454485,
          request: {
            user: {
              name: 'broker'
            }
          },
          response: {}
        };
        const expectedResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('host', _.get(config, 'riemann.prefix', 'CF'))
          .set('service', event.eventName)
          .set('attributes', [{
            key: 'request',
            value: (typeof event.request === 'object' ? JSON.stringify(event.request) : event.request)
          }])
          .value();
        rc.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: false
          }
        });
        expect(riemanSendSpy).to.be.calledOnce;
        expect(riemanEventSpy).to.be.calledOnce;
        const testResponse = riemanEventSpy.firstCall.args[0];
        expect(testResponse).to.be.an('object');
        expect(testResponse).to.eql(expectedResultObject);
      });
    });
  });
});