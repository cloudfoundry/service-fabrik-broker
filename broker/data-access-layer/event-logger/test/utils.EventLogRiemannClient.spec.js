'use strict';

const proxyquire = require('proxyquire');
const config = require('@sf/app-config');
const _ = require('lodash');
const { CONST } = require('@sf/common-utils');

const pubSubStub = {
  publish: () => undefined,
  subscribe: () => undefined
};

const riemannJSStub = {
  send: () => true,
  /* jshint unused:false */
  Event: event => true,
  disconnect: () => true
};

let riemannClientEventHandlers = {};
const RiemannClient = proxyquire('../src/EventLogRiemannClient', {
  'riemann': {
    createClient: function () {
      return {
        on: function (event, callback) {
          _.set(riemannClientEventHandlers, event, callback);
          return true;
        },
        disconnect: function () {
          return riemannJSStub.disconnect();
        },
        Event: function (event) {
          return riemannJSStub.Event(event);
        },
        send: function () {
          return riemannJSStub.send();
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
    let pubSubSpy, riemannSendSpy, riemannEventSpy, riemannDisconnectSpy;

    beforeEach(function () {
      pubSubSpy = sinon.stub(pubSubStub, 'subscribe');
      riemannSendSpy = sinon.stub(riemannJSStub, 'send');
      riemannEventSpy = sinon.stub(riemannJSStub, 'Event');
      riemannDisconnectSpy = sinon.stub(riemannJSStub, 'disconnect');
      pubSubSpy.returns(true);
      riemannSendSpy.returns(true);
      riemannEventSpy.returns(true);
      riemannDisconnectSpy.returns(true);
    });

    afterEach(function () {
      pubSubSpy.restore();
      riemannSendSpy.restore();
      riemannEventSpy.restore();
      riemannDisconnectSpy.restore();
      riemannClientEventHandlers = {};
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
        expect(riemannClient.status).to.eql(CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.INITIALIZING);
        expect(riemannClient.QUEUED_REQUESTS).to.eql([]);
        expect(eventType).to.eql(config.internal.event_type);
        expect(riemannClientEventHandlers.connect).to.be.not.null;
        expect(riemannClientEventHandlers.error).to.be.not.null;
        expect(riemannClientEventHandlers.disconnect).to.be.not.null;
      });
    });

    describe('disconnect', function () {
      it('should disconnect from Riemann Client Successfully', function () {
        const riemannOptions = _
          .chain({})
          .assign(config.riemann)
          .set('event_type', config.internal.event_type)
          .value();
        const riemannClient = new RiemannClient(riemannOptions);
        riemannClient.disconnect();
        expect(riemannDisconnectSpy).to.be.calledOnce;
        expect(riemannClient.status).to.eql(CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.DISCONNECTED);
      });
    });

    describe('send', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      const riemannClient = new RiemannClient(riemannOptions);
      if (riemannClientEventHandlers.connect && _.isFunction(riemannClientEventHandlers.connect)) {
        riemannClientEventHandlers.connect.call(riemannClientEventHandlers.connect);
      } else {
        expect.fail('Event Handlers not registered for riemann client');
      }

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
          .set('metricF', event.metric)
          .value();
        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: true
          }
        });
        expect(riemannSendSpy).to.be.calledOnce;
        expect(riemannEventSpy).to.be.calledOnce;
        const firstResponse = riemannEventSpy.firstCall.args[0];
        expect(firstResponse).to.be.an('object');
        expect(firstResponse).to.eql(expectedFirstResultObject);
      });

      it('should log 2 events successfully to Riemann with response details for create instance', function () {
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
            instance_id: 'fe27a9ea-0e93-485a-86f2-600aa725fc88',
            service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
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
          .set('metricF', event.metric)
          .value();
        const expectedSecondResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('service', `${event.eventName}.instance_id.fe27a9ea-0e93-485a-86f2-600aa725fc88.service_name.blueprint`)
          .set('host', _.get(config, 'riemann.prefix', 'CF'))
          .set('attributes', [{
            key: 'request',
            value: (typeof event.request === 'object' ? JSON.stringify(event.request) : event.request)
          }, {
            key: 'response',
            value: (typeof event.response === 'object' ? JSON.stringify(event.response) : event.response)
          }])
          .set('metricF', event.metric)
          .value();

        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: true
          }
        });
        expect(riemannSendSpy).to.be.calledTwice;
        expect(riemannEventSpy).to.be.calledTwice;
        const firstResponse = riemannEventSpy.firstCall.args[0];
        expect(firstResponse).to.be.an('object');
        expect(firstResponse).to.eql(expectedFirstResultObject);
        const secondResponse = riemannEventSpy.secondCall.args[0];
        expect(secondResponse).to.be.an('object');
        expect(secondResponse).to.eql(expectedSecondResultObject);
      });

      it('should log 2 events successfully to Riemann with response details for start backup', function () {
        const event = {
          host: 'INLN50932351A',
          eventName: 'CF.broker.0.service-fabrik.director.create_backup ',
          metric: 0,
          state: 'ok',
          description: 'Backup service instance',
          tags: ['backup'],
          time: 1483353454485,
          request: {
            user: {
              name: 'broker'
            },
            instance_id: 'fe27a9ea-0e93-485a-86f2-600aa725fc88',
            backup_guid: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
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
          .set('metricF', event.metric)
          .value();
        const expectedSecondResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('service', `${event.eventName}.instance_id.fe27a9ea-0e93-485a-86f2-600aa725fc88.backup_guid.24731fb8-7b84-4f57-914f-c3d55d793dd4`)
          .set('host', _.get(config, 'riemann.prefix', 'CF'))
          .set('attributes', [{
            key: 'request',
            value: (typeof event.request === 'object' ? JSON.stringify(event.request) : event.request)
          }, {
            key: 'response',
            value: (typeof event.response === 'object' ? JSON.stringify(event.response) : event.response)
          }])
          .set('metricF', event.metric)
          .value();

        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: true
          }
        });
        expect(riemannSendSpy).to.be.calledTwice;
        expect(riemannEventSpy).to.be.calledTwice;
        const firstResponse = riemannEventSpy.firstCall.args[0];
        expect(firstResponse).to.be.an('object');
        expect(firstResponse).to.eql(expectedFirstResultObject);
        const secondResponse = riemannEventSpy.secondCall.args[0];
        expect(secondResponse).to.be.an('object');
        expect(secondResponse).to.eql(expectedSecondResultObject);
      });

      it('should log 2 events successfully to Riemann with response details for create binding', function () {
        const event = {
          host: 'INLN50932351A',
          eventName: 'CF.broker.0.service-fabrik.director.create_binding',
          metric: 0,
          state: 'ok',
          description: 'Bind service instance',
          tags: ['binding'],
          time: 1483353454485,
          request: {
            user: {
              name: 'broker'
            },
            instance_id: 'fe27a9ea-0e93-485a-86f2-600aa725fc88',
            app_guid: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
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
          .set('metricF', event.metric)
          .value();
        const expectedSecondResultObject = _
          .chain(event)
          .pick('metric', 'state', 'description', 'tags')
          .set('service', `${event.eventName}.instance_id.fe27a9ea-0e93-485a-86f2-600aa725fc88.app_guid.24731fb8-7b84-4f57-914f-c3d55d793dd4`)
          .set('host', _.get(config, 'riemann.prefix', 'CF'))
          .set('attributes', [{
            key: 'request',
            value: (typeof event.request === 'object' ? JSON.stringify(event.request) : event.request)
          }, {
            key: 'response',
            value: (typeof event.response === 'object' ? JSON.stringify(event.response) : event.response)
          }])
          .set('metricF', event.metric)
          .value();

        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: true
          }
        });
        expect(riemannSendSpy).to.be.calledTwice;
        expect(riemannEventSpy).to.be.calledTwice;
        const firstResponse = riemannEventSpy.firstCall.args[0];
        expect(firstResponse).to.be.an('object');
        expect(firstResponse).to.eql(expectedFirstResultObject);
        const secondResponse = riemannEventSpy.secondCall.args[0];
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
        expect(riemannEventSpy).not.to.have.been.called;
        expect(riemannSendSpy).not.to.have.been.called;
      });
    });

    describe('sendAfterConnectionReset', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      let riemannClient = new RiemannClient(riemannOptions);
      beforeEach(function () {
        riemannClient.disconnect();
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
          .set('metricF', event.metric)
          .value();
        expect(riemannClient.status).to.eql(CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.DISCONNECTED);
        riemannClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {
            include_response_body: false
          }
        });
        expect(riemannClient.status).to.eql(CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.INITIALIZING);
        if (riemannClientEventHandlers.connect && _.isFunction(riemannClientEventHandlers.connect)) {
          riemannClientEventHandlers.connect.call(riemannClientEventHandlers.connect);
        } else {
          expect.fail('Event Handlers not registered for riemann client');
        }
        expect(riemannSendSpy).to.be.calledOnce;
        expect(riemannEventSpy).to.be.calledOnce;
        const testResponse = riemannEventSpy.firstCall.args[0];
        expect(testResponse).to.be.an('object');
        expect(testResponse).to.eql(expectedResultObject);
      });
    });

    describe('sendEvent', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      const riemannClient = new RiemannClient(riemannOptions);
      const info = {
        metric: 0,
        state: 'ok'
      };
      const attempt = 1;

      it('should return true when max attempts are exceeded', function () {
        const response = riemannClient.sendEvent(info, CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_SEND_RETRIES + 1);
        expect(response).to.be.true;
        expect(riemannSendSpy).to.be.not.called;
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql([]);
      });
      it('should return false when client is initializing', function () {
        const expectedQueue = [{
          info: info,
          attempt: attempt
        }];
        const response = riemannClient.sendEvent(info, 1);
        expect(response).to.be.false;
        expect(riemannSendSpy).to.be.not.called;
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql(expectedQueue);
      });
      it('should return false when client is disconnected', function () {
        const riemannClient = new RiemannClient(riemannOptions);
        const expectedQueue = [{
          info: info,
          attempt: attempt
        }];
        if (riemannClientEventHandlers.disconnect && _.isFunction(riemannClientEventHandlers.disconnect)) {
          riemannClientEventHandlers.disconnect.call(riemannClientEventHandlers.disconnect);
        } else {
          expect.fail('Event Handlers not registered for riemann client');
        }
        const response = riemannClient.sendEvent(info, 1);
        expect(response).to.be.false;
        expect(riemannSendSpy).to.be.not.called;
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql(expectedQueue);
        expect(riemannClient.status).to.eql(CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.INITIALIZING);
      });
      it('should return false when there is an error in sending event', function () {
        const riemannClient = new RiemannClient(riemannOptions);
        const expectedQueue = [{
          info: info,
          attempt: (attempt + 1)
        }];
        riemannSendSpy.throws(Error('Dummy error in sending event'));
        if (riemannClientEventHandlers.connect && _.isFunction(riemannClientEventHandlers.connect)) {
          riemannClientEventHandlers.connect.call(riemannClientEventHandlers.connect);
        } else {
          expect.fail('Event Handlers not registered for riemann client');
        }
        const response = riemannClient.sendEvent(info, 1);
        expect(response).to.be.false;
        expect(riemannSendSpy).to.be.calledOnce;
        expect(riemannDisconnectSpy).to.be.calledOnce;
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql(expectedQueue);
        expect(riemannClient.status).to.eql(CONST.EVENT_LOG_RIEMANN_CLIENT_STATUS.INITIALIZING);
        riemannSendSpy.restore();
      });
      it('should return true when event is successfully sent', function () {
        const riemannClient = new RiemannClient(riemannOptions);
        if (riemannClientEventHandlers.connect && _.isFunction(riemannClientEventHandlers.connect)) {
          riemannClientEventHandlers.connect.call(riemannClientEventHandlers.connect);
        } else {
          expect.fail('Event Handlers not registered for riemann client');
        }
        const response = riemannClient.sendEvent(info, 1);
        expect(response).to.be.true;
        expect(riemannSendSpy).to.be.calledOnce;
        expect(riemannDisconnectSpy).to.not.be.called;
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql([]);
      });
    });

    describe('enqueRequest', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      const riemannClient = new RiemannClient(riemannOptions);

      it('should enque request when MAX_QUEUE_SIZE is not exceeded', function () {
        const info = {
          metric: 0,
          state: 'ok'
        };
        riemannClient._enqueRequest(info, 1);
        const expectedQueue = [{
          info: info,
          attempt: 1
        }];
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql(expectedQueue);
      });
      it('should deque and then enque request when MAX_QUEUE_SIZE is exceeded', function () {
        const prevQueueSize = CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_QUEUE_SIZE;
        CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_QUEUE_SIZE = 2;
        riemannClient.QUEUED_REQUESTS = [{
          info: {
            metric: 0,
            state: 'ok'
          },
          attempt: 0
        },
        {
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        }
        ];
        const info = {
          metric: 2,
          state: 'ok'
        };
        riemannClient._enqueRequest(info, 2);
        const expectedQueue = [{
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        },
        {
          info: {
            metric: 2,
            state: 'ok'
          },
          attempt: 2
        }
        ];
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql(expectedQueue);
        CONST.EVENT_LOG_RIEMANN_CLIENT.MAX_QUEUE_SIZE = prevQueueSize;
      });
    });

    describe('dequeRequest', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      const riemannClient = new RiemannClient(riemannOptions);

      it('should return null when queue is empty', function () {
        expect(riemannClient._dequeRequest()).to.be.null;
      });
      it('should deque request from queue', function () {
        riemannClient.QUEUED_REQUESTS = [{
          info: {
            metric: 0,
            state: 'ok'
          },
          attempt: 0
        },
        {
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        }
        ];
        const expectedQueue = [{
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        }];
        const expectedRequest = {
          info: {
            metric: 0,
            state: 'ok'
          },
          attempt: 0
        };
        const request = riemannClient._dequeRequest();
        expect(request).to.be.eql(expectedRequest);
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql(expectedQueue);
      });
    });

    describe('isRequestQueueNonEmpty', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();
      const riemannClient = new RiemannClient(riemannOptions);

      it('should return false when queue is empty', function () {
        expect(riemannClient._isRequestQueueNonEmpty()).to.be.false;
      });
      it('should return true when queue is not empty', function () {
        riemannClient.QUEUED_REQUESTS = [{
          info: {
            metric: 0,
            state: 'ok'
          },
          attempt: 0
        },
        {
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        }
        ];
        expect(riemannClient._isRequestQueueNonEmpty()).to.be.true;
      });
    });

    describe('processOutStandingRequest', function () {
      const riemannOptions = _
        .chain({})
        .assign(config.riemann)
        .set('event_type', config.internal.event_type)
        .value();

      const riemannClient = new RiemannClient(riemannOptions);
      it('should process all events when sendEvent is successful', function () {
        const sendEventSpy = sinon.stub(riemannClient, 'sendEvent').returns(true);
        riemannClient.QUEUED_REQUESTS = [{
          info: {
            metric: 0,
            state: 'ok'
          },
          attempt: 0
        },
        {
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        }
        ];
        riemannClient._processOutStandingRequest();
        expect(sendEventSpy).to.be.calledTwice;
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql([]);
        sendEventSpy.restore();
      });
      it('should process one event when sendEvent fails', function () {
        const sentEventSpy = sinon.stub(riemannClient, 'sendEvent').returns(false);
        riemannClient.QUEUED_REQUESTS = [{
          info: {
            metric: 0,
            state: 'ok'
          },
          attempt: 0
        },
        {
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        }
        ];
        const expectedQueue = [{
          info: {
            metric: 1,
            state: 'ok'
          },
          attempt: 1
        }];
        riemannClient._processOutStandingRequest();
        expect(sentEventSpy).to.be.calledOnce;
        expect(riemannClient.QUEUED_REQUESTS).to.be.eql(expectedQueue);
        sentEventSpy.restore();
      });
      it('should not call sendEvent when queue is empty', function () {
        const riemannClient = new RiemannClient(riemannOptions);
        const sentEventSpy = sinon.stub(riemannClient, 'sendEvent').returns(false);
        riemannClient._processOutStandingRequest();
        expect(sentEventSpy).to.be.not.called;
        sentEventSpy.restore();
      });
    });
  });
});
