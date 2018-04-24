'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const middleware = proxyquire('../lib/middleware', {
  'basic-auth': function (req) {
    return req.auth;
  }
});
const lib = require('../lib');
const quota = require('../lib/quota');
const ServiceFabrikApiController = require('../lib/controllers/ServiceFabrikApiController');
const config = require('../lib/config');
const CONST = require('../lib/constants');
const quotaManager = quota.quotaManager;
const utils = lib.utils;
const errors = lib.errors;
const MethodNotAllowed = errors.MethodNotAllowed;
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const BadRequest = errors.BadRequest;
const Forbidden = errors.Forbidden;
const PROMISE_WAIT_SIMULATED_DELAY = 2;

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
      this[method].reset();
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
    next.reset();
    res.reset();
  });

  describe('#basicAuth', () => {
    const basicAuthMiddleware = middleware.basicAuth('admin', 'secret');
    const unauthorizedError = new Unauthorized();

    it('should abort with an Unauthorized error', () => {
      basicAuthMiddleware(req, res, next);
      expect(res.set).to.be.calledOnce.calledWith('WWW-Authenticate');
      expect(next).to.have.been.calledOnce.calledWithExactly(unauthorizedError);
    });

    it('should call the next handler', () => {
      req.auth.name = 'admin';
      basicAuthMiddleware(req, res, next);
      expect(next).to.have.been.calledOnce.calledWithExactly();
    });
  });

  describe('#methodNotAllowed', () => {
    const allow = 'GET';
    const methodNotAllowedMiddleware = middleware.methodNotAllowed(allow);
    const methodNotAllowedError = new MethodNotAllowed(req.method, allow);

    it('should abort with a MethodNotAllowed error', () => {
      methodNotAllowedMiddleware(req, req, next);
      expect(next).to.have.been.calledOnce.and.calledWithExactly(methodNotAllowedError);
    });
  });

  describe('#notFound', () => {
    const notFoundMiddleware = middleware.notFound();
    const notFoundError = new NotFound(
      `Unable to find any resource matching the requested path ${req.path}`);

    it('should always abort with a NotFound error', () => {
      notFoundMiddleware(req, res, next);
      expect(next).to.have.been.calledOnce.and.calledWithExactly(notFoundError);
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
      const errorWithStackMiddleware = middleware.error(true);
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
      const errorMiddleware = middleware.error({
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

describe('#timeout', function () {
  const original_http_timeout = config.http_timeout;
  let app, getInfoStub;
  before(function () {
    getInfoStub = sinon.stub(ServiceFabrikApiController.prototype, 'getInfo');
    config.http_timeout = 10;
    delete require.cache[require.resolve('./support/apps')];
    delete require.cache[require.resolve('../lib')];
    delete require.cache[require.resolve('../lib/routes')];
    delete require.cache[require.resolve('../lib/routes/api')];
    delete require.cache[require.resolve('../lib/routes/api/v1')];
    delete require.cache[require.resolve('../lib/controllers')];
    app = require('./support/apps').external;
  });
  after(function () {
    config.http_timeout = original_http_timeout;
    getInfoStub.restore();
    delete require.cache[require.resolve('./support/apps')];
    delete require.cache[require.resolve('../lib')];
    delete require.cache[require.resolve('../lib/routes')];
    delete require.cache[require.resolve('../lib/routes/api')];
    delete require.cache[require.resolve('../lib/routes/api/v1')];
    delete require.cache[require.resolve('../lib/controllers')];
    app = require('./support/apps').external;
  });
  it('should return 503 after timeout occurs', function () {
    return chai.request(app)
      .get(`/api/v1/info`)
      .catch(err => err.response)
      .then(
        res => {
          expect(res).to.have.status(503);
        });
  });
});

describe('#checkQuota', () => {
  /* jshint expr:true */
  const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
  const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f'; // name: 'v1.0-xsmall'
  const plan_id_update = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a'; // name: 'v1.0-large'
  const plan_id_major_version_update = 'gd158c9a-7934-401e-94ab-057082a5073e'; // name: 'v2.0-xsmall'
  const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
  const notEntitledPlanName = 'v1.0-large';
  const validQuotaPlanName = 'v2.0-xsmall';
  const invalidQuotaPlanName = 'v1.0-xsmall';
  const serviceName = 'blueprint';
  const invalidServiceName = 'not-a-valid-service';
  const err = 'Error in calculating quota';
  const operationParameters = {
    'service-fabrik-operation': 'token'
  };
  const parameters = {
    foo: 'bar'
  };
  let isServiceFabrikOperationStub, isNotPlanUpdateStub, isSameSkuUpdateStub, checkQuotaStub;
  const checkQuota = middleware.checkQuota();
  const res = new Response();
  const next = sinon.spy();
  const operationsBody = {
    service_id: service_id,
    plan_id: plan_id_update,
    parameters: operationParameters,
    //context: context,
    previous_values: {
      plan_id: plan_id,
      service_id: service_id
    }
  };
  const notPlanUpdateBody = {
    service_id: service_id,
    plan_id: plan_id,
    parameters: parameters,
    //context: context,
    previous_values: {
      plan_id: plan_id,
      service_id: service_id
    }
  };
  const isSameSkuUpdateBody = {
    service_id: service_id,
    plan_id: plan_id_major_version_update,
    parameters: parameters,
    //context: context,
    previous_values: {
      plan_id: plan_id,
      service_id: service_id
    }
  };
  const nonCFContextBody = {
    service_id: service_id,
    plan_id: plan_id_update,
    parameters: parameters,
    context: {
      platform: 'kubernetes'
    },
    previous_values: {
      plan_id: plan_id,
      service_id: service_id
    }
  };
  const CFContextBody = {
    service_id: service_id,
    plan_id: plan_id_update,
    parameters: parameters,
    context: {
      platform: 'cloudfoundry'
    },
    previous_values: {
      plan_id: plan_id,
      service_id: service_id
    }
  };
  const validBody = {
    service_id: service_id,
    plan_id: plan_id_update,
    parameters: parameters,
    context: {
      platform: 'cloudfoundry'
    },
    previous_values: {
      plan_id: plan_id,
      service_id: service_id,
      organization_id: organization_guid
    }
  };
  const notEntitledInstance = {
    plan: {
      name: notEntitledPlanName
    },
    service: {
      name: serviceName
    }
  };
  const invalidQuotaInstance = {
    plan: {
      name: invalidQuotaPlanName
    },
    service: {
      name: serviceName
    }
  };
  const validQuotaInstance = {
    plan: {
      name: validQuotaPlanName
    },
    service: {
      name: serviceName
    }
  };
  const errQuotaInstance = {
    plan: {
      name: validQuotaPlanName
    },
    service: {
      name: invalidServiceName
    }
  };
  var req = {
    method: 'PATCH',
    path: '/foo',
    auth: {
      name: 'user',
      pass: 'secret'
    },
    body: {},
    instance: {}
  };
  beforeEach(function () {
    isServiceFabrikOperationStub = sinon.stub(utils, 'isServiceFabrikOperation');
    isServiceFabrikOperationStub.withArgs(operationsBody).returns(true);
    isNotPlanUpdateStub = sinon.stub(utils, 'isNotPlanUpdate');
    isNotPlanUpdateStub.withArgs(notPlanUpdateBody).returns(true);
    isSameSkuUpdateStub = sinon.stub(utils, 'isSameSkuUpdate');
    isSameSkuUpdateStub.withArgs(isSameSkuUpdateBody).returns(true);
    checkQuotaStub = sinon.stub(quotaManager, 'checkQuota');
    checkQuotaStub.withArgs(organization_guid, plan_id_update, notEntitledPlanName, serviceName).returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED));
    checkQuotaStub.withArgs(organization_guid, plan_id_update, invalidQuotaPlanName, serviceName).returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA));
    checkQuotaStub.withArgs(organization_guid, plan_id_update, validQuotaPlanName, serviceName).returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA));
  });
  afterEach(function () {
    next.reset();
    res.reset();
    isServiceFabrikOperationStub.restore();
    isNotPlanUpdateStub.restore();
    isSameSkuUpdateStub.restore();
    checkQuotaStub.restore();
  });
  it('should call isServiceFabrikOperation and next', () => {
    req.body = operationsBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.not.have.been.called;
    expect(isSameSkuUpdateStub).to.not.have.been.called;
    expect(checkQuotaStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce.calledWithExactly();
  });
  it('should call isNotPlanUpdate and next', () => {
    req.body = notPlanUpdateBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.not.have.been.called;
    expect(checkQuotaStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce.calledWithExactly();
  });
  it('should call isSameSkuUpdate and next', () => {
    req.body = isSameSkuUpdateBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce.calledWithExactly();
  });
  it('not CF platform, should call next', () => {
    req.body = nonCFContextBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce.calledWithExactly();
  });
  it('CF platform, org id undefined, should call next with BadRequest', () => {
    req.body = CFContextBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce.calledWithExactly(new BadRequest(`organization_id is undefined`));
  });
  it('Quota not entitled, should call next with Forbidden', () => {
    req.body = validBody;
    req.instance = notEntitledInstance;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly(new Forbidden(`Not entitled to create service instance`)));
  });
  it('Quota invalid, should call next with Forbidden', () => {
    req.body = validBody;
    req.instance = invalidQuotaInstance;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly(new Forbidden(`Quota is not sufficient for this request`)));
  });
  it('Quota valid, should call next', () => {
    req.body = validBody;
    req.instance = validQuotaInstance;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly());
  });
  it('Quota funtion throws error, should call next with error', () => {
    checkQuotaStub.withArgs(organization_guid, plan_id_update, validQuotaPlanName, invalidServiceName).returns(Promise.reject(err));
    req.body = validBody;
    req.instance = errQuotaInstance;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(isNotPlanUpdateStub).to.have.been.calledOnce;
    expect(isSameSkuUpdateStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly(err));
  });
});