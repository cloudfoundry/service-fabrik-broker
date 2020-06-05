'use strict';

const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const middleware = proxyquire('../../applications/osb-broker/src/api-controllers/middleware', {
  'basic-auth': function (req) {
    return req.auth;
  }
});
const {
  CONST,
  errors: {
    Forbidden
  },
  commonFunctions
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const { catalog } = require('@sf/models');
const ServiceFabrikApiController = require('../../applications/extensions/src/api-controllers/ServiceFabrikApiController');
const QuotaClient = require('../../applications/osb-broker/src/api-controllers/middleware/QuotaClient');
const PROMISE_WAIT_SIMULATED_DELAY = 30;

class Response {
  constructor() {
    this.constructor.methods.forEach(method => {
      this[method] = sinon.spy(function () {
        return this;
      });
    });
  }
  reset() {
    this.constructor.methods.forEach(method => {
      this[method].resetHistory();
    });
  }
  static get methods() {
    return ['set', 'status', 'sendStatus', 'send', 'json', 'render', 'format'];
  }
}

describe('#timeout', function () {
  const original_http_timeout = config.http_timeout;
  let app, getInfoStub;
  before(function () {
    getInfoStub = sinon.stub(ServiceFabrikApiController.prototype, 'getInfo');
    config.http_timeout = 10;
    delete require.cache[require.resolve('./support/apps')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers/routes')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers/routes/api')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers/routes/api/v1')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers')];
    app = require('./support/apps').external;
  });
  after(function () {
    config.http_timeout = original_http_timeout;
    getInfoStub.restore();
    delete require.cache[require.resolve('./support/apps')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers/routes')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers/routes/api')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers/routes/api/v1')];
    delete require.cache[require.resolve('../../applications/extensions/src/api-controllers')];
    app = require('./support/apps').external;
  });
  it('should return 503 after timeout occurs', function () {
    return chai.request(app)
      .get('/api/v1/info')
      .catch(err => err.response)
      .then(
        res => {
          expect(res).to.have.status(503);
        });
  });
});

describe('#checkQuota', () => {
  before(function () {
    config.quota.enabled = true;
  });
  after(function () {
    config.quota.enabled = false;
  });
  /* jshint expr:true */
  const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
  const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f'; // name: 'v1.0-xsmall'
  const plan_id_update = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a'; // name: 'v1.0-large'
  const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
  const subaccount_id = 'b319968c-0eba-43f2-959b-40f507c269fd';
  const notEntitledPlanId = 'bc158c9a-7934-401e-94ab-057082a5073e';
  const validQuotaPlanId = 'bc158c9a-7934-401e-94ab-057082a5073f';
  const invalidQuotaPlanId = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
  const errQuotaPlanId = 'errQuotaPlanId';
  const err = 'Error in calculating quota';
  const operationParameters = {
    'service-fabrik-operation': 'token'
  };
  const parameters = {
    foo: 'bar'
  };
  let isServiceFabrikOperationStub, checkQuotaValidityStub;
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
  const k8sContextBody = {
    service_id: service_id,
    plan_id: validQuotaPlanId,
    parameters: parameters,
    context: {
      platform: 'kubernetes',
      subaccount_id: subaccount_id
    }
  };
  const SMCFContextBody = {
    service_id: service_id,
    plan_id: validQuotaPlanId,
    parameters: parameters,
    context: {
      platform: 'sapcp',
      origin: 'cloudfoundry',
      organization_guid: organization_guid,
      subaccount_id: subaccount_id
    },
    previous_values: {
      service_id: service_id
    }
  };

  const SMK8SContextBody = {
    service_id: service_id,
    plan_id: validQuotaPlanId,
    parameters: parameters,
    context: {
      platform: 'sapcp',
      origin: 'kubernetes',
      subaccount_id: subaccount_id
    },
    previous_values: {
      service_id: service_id
    }
  };

  const notEntitledBody = {
    service_id: service_id,
    plan_id: notEntitledPlanId,
    parameters: parameters,
    context: {
      platform: 'cloudfoundry'
    },
    previous_values: {
      service_id: service_id,
      organization_id: organization_guid
    }
  };
  const invalidQuotaBody = {
    service_id: service_id,
    plan_id: invalidQuotaPlanId,
    parameters: parameters,
    context: {
      platform: 'cloudfoundry'
    },
    previous_values: {
      service_id: service_id,
      organization_id: organization_guid
    }
  };
  const validQuotaBody = {
    service_id: service_id,
    plan_id: validQuotaPlanId,
    parameters: parameters,
    context: {
      platform: 'cloudfoundry'
    },
    previous_values: {
      service_id: service_id,
      organization_id: organization_guid
    }
  };
  const errQuotaBody = {
    service_id: service_id,
    plan_id: errQuotaPlanId,
    parameters: parameters,
    context: {
      platform: 'cloudfoundry'
    },
    previous_values: {
      service_id: service_id,
      organization_id: organization_guid
    }
  };
  let req = {
    method: 'PATCH',
    path: '/foo',
    auth: {
      name: 'user',
      pass: 'secret'
    },
    body: {
      plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f'
    }
  };
  beforeEach(function () {
    isServiceFabrikOperationStub = sinon.stub(commonFunctions, 'isServiceFabrikOperation');
    isServiceFabrikOperationStub.withArgs(operationsBody).returns(true);
    checkQuotaValidityStub = sinon.stub(QuotaClient.prototype, 'checkQuotaValidity');
  });
  afterEach(function () {
    next.resetHistory();
    res.reset();
    isServiceFabrikOperationStub.restore();
    checkQuotaValidityStub.restore();
  });
  it('should call isServiceFabrikOperation and next', () => {
    req.body = operationsBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce.calledWithExactly();
  });
  it('K8S platform, should call next', () => {
    req.body = k8sContextBody;
    process.env.POD_NAMESPACE = 'default';
    checkQuotaValidityStub.resolves(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA);
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.called;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: subaccount_id,
      queryParams: {
        planId: validQuotaPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: true,
        reqMethod: 'PATCH'
      }
    }, true);
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        delete process.env.POD_NAMESPACE;
        expect(next).to.have.been.calledOnce.calledWithExactly()
      });
  });
  it('Quota not entitled, should call next with Forbidden', () => {
    req.body = notEntitledBody;
    checkQuotaValidityStub.resolves(CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED);
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.called;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: organization_guid,
      queryParams: {
        planId: notEntitledPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: false,
        reqMethod: 'PATCH'
      }
    }, true);
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        expect(next).to.have.been.calledOnce;
        expect(next.getCall(0).args[0] instanceof Forbidden);
      });
  });
  it('Quota invalid, should call next with Forbidden', () => {
    req.body = invalidQuotaBody;
    checkQuotaValidityStub.resolves(CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA);
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.called;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: organization_guid,
      queryParams: {
        planId: invalidQuotaPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: false,
        reqMethod: 'PATCH'
      }
    }, true);
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        expect(next).to.have.been.calledOnce;
        expect(next.getCall(0).args[0] instanceof Forbidden);
      });
  });
  it('Quota valid, should call next', () => {
    req.body = validQuotaBody;
    checkQuotaValidityStub.resolves(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA);
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.called;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: organization_guid,
      queryParams: {
        planId: validQuotaPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: false,
        reqMethod: 'PATCH'
      }
    }, true);
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly());
  });
  it('Non instance based quota, Quota valid, should call next', () => {
    req.body = validQuotaBody;
    let getServiceStub = sinon.stub(catalog, 'getService');
    getServiceStub.returns({quota_check_type: 'composite'});
    checkQuotaValidityStub.resolves(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA);
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.called;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: organization_guid,
      queryParams: {
        planId: validQuotaPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: false,
        reqMethod: 'PATCH'
      },
      data: req.body
    }, false);
    getServiceStub.restore();
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly());
  });
  it('SMCF platform, Quota valid, should call next', () => {
    req.body = SMCFContextBody;
    checkQuotaValidityStub.resolves(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA);
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.called;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: organization_guid,
      queryParams: {
        planId: validQuotaPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: false,
        reqMethod: 'PATCH'
      }
    }, true);
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly());
  });

  it('SMK8S platform, Quota valid, should call next', () => {
    req.body = SMK8SContextBody;
    process.env.POD_NAMESPACE = 'default';
    checkQuotaValidityStub.resolves(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA);
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.called;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: subaccount_id,
      queryParams: {
        planId: validQuotaPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: true,
        reqMethod: 'PATCH'
      }
    }, true);
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        delete process.env.POD_NAMESPACE;
        expect(next).to.have.been.calledOnce.calledWithExactly()
      });
  });

  it('Quota funtion throws error, should call next with error', () => {
    checkQuotaValidityStub.returns(Promise.reject(err));
    req.body = errQuotaBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaValidityStub).to.have.been.calledWithExactly({
      orgOrSubaccountId: organization_guid,
      queryParams: {
        planId: errQuotaPlanId,
        previousPlanId: undefined,
        isSubaccountFlag: false,
        reqMethod: 'PATCH'
      }
    }, true);
    expect(checkQuotaValidityStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly(err));
  });
});
