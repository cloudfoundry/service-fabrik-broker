'use strict';
const _ = require('lodash');
const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const mongoose = require('mongoose');
const pubsub = require('pubsub-js');
const {
  CONST
} = require('@sf/common-utils');
const dbManager = require('../../data-access-layer/db/DBManager');

const handlers = {};
const CONNECTION_WAIT_SIMULATED_DELAY = 0;
let mongoReachable = true;
const mongoStub = {
  connect: () => {},
  on: () => {},
  close: () => {}
};

/* jshint unused:false */
/* jshint expr:true */
class Mongoose {
  constructor() {
    this.connection = {
      on: (eventName, handler) => {
        mongoStub.on(eventName, handler);
        _.set(handlers, eventName, handler);
        return true;
      },
      close: () => {
        mongoStub.close();
      }
    };
  }
  connect(url) {
    mongoStub.connect();
    return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY).then(() => {
      if (mongoReachable) {
        if (handlers.connected && _.isFunction(handlers.connected)) {
          handlers.connected.call(handlers.connected);
        }
      } else {
        throw new Error('MongoDb unreachable.. Simulated test error. Expected Ignore!');
      }
    });
  }
}

const dbInitializer = proxyquire('../../data-access-layer/db/DbConnectionManager', {
  'mongoose': new Mongoose()
});

describe('db', function () {
  describe('#DbConnectionManager', function () {
    let mongooseConnectionStub, publishStub, subscribeStub, sandbox, processExitStub;

    before(function () {
      sandbox = sinon.createSandbox();
      mongooseConnectionStub = sandbox.stub(mongoStub);
      processExitStub = sandbox.stub(process, 'exit');
      publishStub = sandbox.stub(pubsub, 'publish').callsFake((topic, data) => {
        if (handlers[topic] && _.isFunction(handlers[topic])) {
          handlers[topic].call(handlers[topic], data);
        }
      });
      subscribeStub = sandbox.stub(pubsub, 'subscribe').callsFake((topic, handler) => {
        handlers[topic] = handler;
      });
    });

    afterEach(function () {
      mongooseConnectionStub.connect.resetHistory();
      mongooseConnectionStub.on.resetHistory();
      publishStub.resetHistory();
      subscribeStub.resetHistory();
    });

    after(function () {
      sandbox.restore();
    });

    it('Should initialize and publish Mongo-Operational event when MongoD is reachable', function () {
      const config = {
        url: 'mongodb://localhost:27017/service-fabrik'
      };
      mongoReachable = true;
      const dbInit = dbInitializer.startUp(config);
      expect(mongooseConnectionStub.connect).to.be.calledOnce;
      expect(mongooseConnectionStub.on).to.be.calledThrice;
      expect(mongooseConnectionStub.on.firstCall.args[0]).to.eql('connected');
      expect(mongooseConnectionStub.on.secondCall.args[0]).to.eql('error');
      expect(mongooseConnectionStub.on.thirdCall.args[0]).to.eql('disconnected');
      return dbInit.then(() => {
        expect(publishStub).to.be.calledOnce;
        expect(publishStub.firstCall.args[0]).to.eql(CONST.TOPIC.MONGO_OPERATIONAL);
        expect(subscribeStub).to.be.calledOnce;
        expect(subscribeStub.firstCall.args[0]).to.eql(CONST.TOPIC.APP_SHUTTING_DOWN);
      });
    });

    it('Should publish Mongo-Init-Failed event when MongoD is unreachable', function () {
      const config = {
        url: 'mongodb://localhost:27017/service-fabrik',
        retry_connect: {
          max_attempt: 0,
          min_delay: 0
        }
      };
      mongoReachable = false;
      const dbInit = dbInitializer.startUp(config);
      return Promise.delay(30)
        .then(() => {
          expect(mongooseConnectionStub.connect).to.be.calledTwice; // Once for initial connect and second during retry
          expect(mongooseConnectionStub.on.callCount).to.equal(6); // 3*2 - 3 more times during retry.
          expect(mongooseConnectionStub.on.firstCall.args[0]).to.eql('connected');
          expect(mongooseConnectionStub.on.secondCall.args[0]).to.eql('error');
          expect(mongooseConnectionStub.on.thirdCall.args[0]).to.eql('disconnected');
          expect(publishStub).to.be.calledOnce;
          expect(publishStub.firstCall.args[0]).to.eql(CONST.TOPIC.MONGO_INIT_FAILED);
        });
    });

    it('Should close mongo connections on recieving App shutdown event', function () {
      const config = {
        url: 'mongodb://localhost:27017/service-fabrik'
      };
      mongoReachable = true;
      const dbInit = dbInitializer.startUp(config);
      expect(mongooseConnectionStub.connect).to.be.calledOnce;
      expect(mongooseConnectionStub.on).to.be.calledThrice;
      expect(mongooseConnectionStub.on.firstCall.args[0]).to.eql('connected');
      expect(mongooseConnectionStub.on.secondCall.args[0]).to.eql('error');
      expect(mongooseConnectionStub.on.thirdCall.args[0]).to.eql('disconnected');
      return dbInit.then(() => {
        expect(publishStub).to.be.calledOnce;
        expect(publishStub.firstCall.args[0]).to.eql(CONST.TOPIC.MONGO_OPERATIONAL);
        expect(subscribeStub).to.be.calledOnce;
        expect(subscribeStub.firstCall.args[0]).to.eql(CONST.TOPIC.APP_SHUTTING_DOWN);
        publishStub(CONST.TOPIC.APP_SHUTTING_DOWN);
        expect(mongooseConnectionStub.close).to.be.calledOnce;
      });
    });
  });
});
