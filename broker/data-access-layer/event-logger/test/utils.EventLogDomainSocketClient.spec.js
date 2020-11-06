'use strict';

const proxyquire = require('proxyquire');
const config = require('@sf/app-config');
const logger = require('@sf/logger');
let EventEmitter = require('events').EventEmitter;
const _ = require('lodash');

const pubSubStub = {
  publish: () => undefined,
  subscribe: () => undefined
};

const netConnectionStub = {
  /* jshint unused:false */
  write: event => true,
  end: () => true
};

class Connection extends EventEmitter {
  constructor(path, callback) {
    super();
    process.nextTick(() => {
      this.emit('connect');
    });
    super.on('connect', () => callback());
    return this;
  }
  on() {
    return this;
  }
  write(event) {
    netConnectionStub.write(event);
  }
  end() {
    netConnectionStub.end();
  }
}
const DomainSocketClient = proxyquire('../src/EventLogDomainSocketClient', {
  net: {
    createConnection: (path, callback) => {
      return new Connection(path, callback);
    }
  },
  'pubsub-js': {
    subscribe: (eventType, callBack) => {
      return pubSubStub.subscribe(eventType, callBack);
    }
  }
});

describe('utils', function () {
  /* jshint expr:true */
  describe('EventLogDomainSocketClient', function () {
    let pubSubSpy, netConnWriteSpy, netConnEndSpy;

    beforeEach(function () {
      pubSubSpy = sinon.stub(pubSubStub, 'subscribe');
      netConnWriteSpy = sinon.stub(netConnectionStub, 'write');
      netConnEndSpy = sinon.stub(netConnectionStub, 'end');
      pubSubSpy.returns(true);
      netConnWriteSpy.returns(true);
    });

    afterEach(function () {
      pubSubSpy.restore();
      netConnWriteSpy.restore();
      netConnEndSpy.restore();
    });

    describe('create', function () {
      it('should throw an error if domain socket path is empty', function () {
        const domainSockOpts = {};
        try {
          const domainSockClient = new DomainSocketClient(domainSockOpts);
        } catch (err) {
          expect(err.message).to.eql('Domain socket path cannot be empty');
        }
      });

      it('should create DomainSocketClient Successfully and subscribe to the input event type', function () {
        const domainSockOpts = _
          .chain({})
          .assign(config.internal.domain_socket)
          .set('event_type', config.internal.event_type)
          .value();
        const domainSockClient = new DomainSocketClient(domainSockOpts);
        expect(pubSubSpy).to.be.called;
        const eventType = pubSubSpy.firstCall.args[0];
        expect(domainSockClient).to.be.an('object');
        expect(eventType).to.eql(config.internal.event_type);
      });
    });
    describe('handleEvent', function () {
      const domainSockOpts = _
        .chain({})
        .assign(config.internal.domain_socket)
        .set('event_type', config.internal.event_type)
        .value();
      const domainSocketClient = new DomainSocketClient(domainSockOpts);
      it('should write event successfully to domain socket', function (done) {
        const event = {
          host: 'INLN50932351A',
          eventName: 'CF.broker.0.servicefabrik.director.create_instance',
          metric: 0,
          state: 'ok',
          description: 'Successfully created service instance',
          tags: ['catalog'],
          time: 1483353454485,
          request: {
            user: {
              name: 'broker'
            }
          },
          response: {}
        };
        domainSocketClient.handleEvent(config.internal.event_type, {
          event: event,
          options: {}
        });
        process.nextTick(() => {
          // Being done in nextTick as connect callbacks are fired in nextTick() - see above.
          expect(netConnWriteSpy).to.be.calledOnce;
          expect(netConnEndSpy).to.be.calledOnce;
          const testResponse = netConnWriteSpy.firstCall.args[0];
          expect(testResponse).to.be.an('string');
          expect(testResponse).to.eql(JSON.stringify(event));
          done();
        });
      });
    });
  });
});
