'use strict';

const proxyquire = require('proxyquire');
const config = require('../lib').config;
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
const RiemannClient = proxyquire('../lib/utils/RiemannClient', {
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
  describe('RiemannClient', function () {
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
        const expectedSecondResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('service', `${event.eventName}-guid-not-present-in-request`)
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
        const secondResponse = riemanEventSpy.secondCall.args[0];
        expect(firstResponse).to.be.an('object');
        expect(firstResponse).to.eql(expectedFirstResultObject);
        expect(secondResponse).to.be.an('object');
        expect(secondResponse).to.eql(expectedSecondResultObject);
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
        expect(riemanSendSpy).to.be.calledTwice;
        expect(riemanEventSpy).to.be.calledTwice;
        const testResponse = riemanEventSpy.firstCall.args[0];
        expect(testResponse).to.be.an('object');
        expect(testResponse).to.eql(expectedResultObject);
      });
    });
  });
});