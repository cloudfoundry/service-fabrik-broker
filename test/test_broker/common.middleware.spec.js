'use strict';

const _ = require('lodash');
const proxyquire = require('proxyquire');
const commonMiddleware = proxyquire('../../common/middleware', {
  'basic-auth': function (req) {
    return req.auth;
  }
});
const errors = require('../../common/errors');
const MethodNotAllowed = errors.MethodNotAllowed;
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;

class Response {
  constructor() {
    this.constructor.methods.forEach((method) => {
      this[method] = sinon.spy(function () {
        return this;
      });
    });
  }
  reset() {
    this.constructor.methods.forEach((method) => {
      this[method].resetHistory();
    });
  }
  static get methods() {
    return ['set', 'status', 'sendStatus', 'send', 'json', 'render', 'format'];
  }
}

describe('middleware', () => {
  /* jshint expr:true */
  const req = {
    method: 'POST',
    path: '/foo',
    auth: {
      name: 'user',
      pass: 'secret'
    }
  };

  const res = new Response();
  const next = sinon.spy();

  afterEach(function () {
    next.resetHistory();
    res.reset();
  });

  describe('#basicAuth', () => {
    const basicAuthMiddleware = commonMiddleware.basicAuth('admin', 'secret');

    it('should abort with an Unauthorized error', () => {
      basicAuthMiddleware(req, res, next);
      expect(res.set).to.be.calledOnce.calledWith('WWW-Authenticate');
      expect(next.getCall(0).args[0] instanceof Unauthorized).to.be.true;
      expect(next).to.have.been.calledOnce;
    });

    it('should call the next handler', () => {
      req.auth.name = 'admin';
      basicAuthMiddleware(req, res, next);
      expect(next).to.have.been.calledOnce.calledWithExactly();
    });
  });

  describe('#methodNotAllowed', () => {
    const allow = 'GET';
    const methodNotAllowedMiddleware = commonMiddleware.methodNotAllowed(allow);

    it('should abort with a MethodNotAllowed error', () => {
      methodNotAllowedMiddleware(req, req, next);
      expect(next).to.have.been.calledOnce;
      expect(next.getCall(0).args[0] instanceof MethodNotAllowed);
    });
  });

  describe('#notFound', () => {
    const notFoundMiddleware = commonMiddleware.notFound();

    it('should always abort with a NotFound error', () => {
      notFoundMiddleware(req, res, next);
      expect(next).to.have.been.calledOnce;
      expect(next.getCall(0).args[0] instanceof NotFound);
    });
  });

  describe('#error', () => {
    const error = {
      message: 'a message',
      foo: 'bar',
      stack: 'a stack trace',
      reason: 'error'
    };
    const originalError = _.clone(error);

    describe('with stack trace', () => {
      const errorWithStackMiddleware = commonMiddleware.error(true);
      const errorResponse = _.assign(_.pick(originalError, 'stack'), {
        status: 500,
        error: originalError.reason,
        description: originalError.message
      });
      let responseFormatter;

      beforeEach(function () {
        errorWithStackMiddleware(error, req, res, next);
        expect(res.format).to.have.been.calledOnce;
        responseFormatter = _.first(res.format.firstCall.args);
      });

      it('should not modify the error object', () => {
        expect(error).to.eql(originalError);
      });

      it('should respond with status 500 by default', () => {
        expect(res.status).to.have.been.calledOnce.and.calledWithExactly(500);
        expect(next).to.not.have.been.called;
      });

      it('should respond with an error in json format', () => {
        responseFormatter.json();
        expect(res.json).to.have.been.calledWithExactly(errorResponse);
        expect(next).to.not.have.been.called;
      });

      it('should respond with an error in html format', () => {
        responseFormatter.html();
        expect(res.render).to.have.been.calledWithExactly('error', errorResponse);
        expect(next).to.not.have.been.called;
      });

      it('should respond with an error in html format', () => {
        responseFormatter.text();
        let responseText = _.first(res.send.firstCall.args);
        let parsedResponseText = _.chain(responseText).split('\n').map((line) => {
          let [key, val] = line.split(/:\s*/);
          return [key, key !== 'status' ? val : parseInt(val)];
        }).fromPairs().value();
        expect(parsedResponseText).to.eql(errorResponse);
        expect(next).to.not.have.been.called;
      });

      it('should respond with a NotAcceptable error', () => {
        responseFormatter.default();
        expect(res.status).to.have.been.calledOnce.calledWithExactly(500);
        expect(res.sendStatus).to.have.been.calledOnce.calledWithExactly(406);
        expect(next).to.not.have.been.called;
      });
    });

    describe('without stack trace', () => {
      const errorMiddleware = commonMiddleware.error({
        env: 'production'
      });
      let responseFormatter;

      beforeEach(function () {
        errorMiddleware(error, req, res, next);
        expect(res.format).to.have.been.calledOnce;
        responseFormatter = _.first(res.format.firstCall.args);
      });

      it('should respond with an error that does not include a stack trace', () => {
        responseFormatter.json();
        expect(_.first(res.json.firstCall.args)).to.not.have.property('stack');
      });
    });
  });
});