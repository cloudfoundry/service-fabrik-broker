'use strict';

const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const middleware = proxyquire('../../broker/lib/middleware', {
  'basic-auth': function (req) {
    return req.auth;
  }
});
const CONST = require('../../common/constants');
const config = require('../../common/config');
const ServiceFabrikApiController = require('../../api-controllers/ServiceFabrikApiController');
const quotaManager = require('../../quota/cf-platform-quota-manager').cfPlatformQuotaManager;
const k8squotaManager = require('../../quota/k8s-platform-quota-manager').k8sPlatformQuotaManager;
const utils = require('../../common/utils');
const errors = require('../../common/errors');
const BadRequest = errors.BadRequest;
const Forbidden = errors.Forbidden;
const PROMISE_WAIT_SIMULATED_DELAY = 30;

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

describe('#timeout', function () {
  const original_http_timeout = config.http_timeout;
  let app, getInfoStub;
  before(function () {
    getInfoStub = sinon.stub(ServiceFabrikApiController.prototype, 'getInfo');
    config.http_timeout = 10;
    delete require.cache[require.resolve('./support/apps')];
    delete require.cache[require.resolve('../../broker/lib')];
    delete require.cache[require.resolve('../../api-controllers/routes')];
    delete require.cache[require.resolve('../../api-controllers/routes/api')];
    delete require.cache[require.resolve('../../api-controllers/routes/api/v1')];
    delete require.cache[require.resolve('../../api-controllers')];
    app = require('./support/apps').external;
  });
  after(function () {
    config.http_timeout = original_http_timeout;
    getInfoStub.restore();
    delete require.cache[require.resolve('./support/apps')];
    delete require.cache[require.resolve('../../broker/lib')];
    delete require.cache[require.resolve('../../api-controllers/routes')];
    delete require.cache[require.resolve('../../api-controllers/routes/api')];
    delete require.cache[require.resolve('../../api-controllers/routes/api/v1')];
    delete require.cache[require.resolve('../../api-controllers')];
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
  let isServiceFabrikOperationStub, checkQuotaStub, checkK8SQuotaStub;
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
  var req = {
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
    isServiceFabrikOperationStub = sinon.stub(utils, 'isServiceFabrikOperation');
    isServiceFabrikOperationStub.withArgs(operationsBody).returns(true);
    checkQuotaStub = sinon.stub(quotaManager, 'checkQuota');
    checkK8SQuotaStub = sinon.stub(k8squotaManager, 'checkQuota');
    checkQuotaStub.withArgs(organization_guid, notEntitledPlanId, undefined, 'PATCH').returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED));
    checkQuotaStub.withArgs(organization_guid, invalidQuotaPlanId, undefined, 'PATCH').returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA));
    checkQuotaStub.withArgs(organization_guid, validQuotaPlanId, undefined, 'PATCH').returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA));
    checkK8SQuotaStub.withArgs(subaccount_id, validQuotaPlanId, undefined, 'PATCH').returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA));
    checkK8SQuotaStub.withArgs(subaccount_id, validQuotaPlanId, undefined, 'PATCH', true).returns(Promise.resolve(CONST.QUOTA_API_RESPONSE_CODES.VALID_QUOTA));
  });
  afterEach(function () {
    next.resetHistory();
    res.reset();
    isServiceFabrikOperationStub.restore();
    checkQuotaStub.restore();
    checkK8SQuotaStub.restore();
  });
  it('should call isServiceFabrikOperation and next', () => {
    req.body = operationsBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce.calledWithExactly();
  });
  it('K8S platform, should call next', () => {
    req.body = k8sContextBody;
    process.env.POD_NAMESPACE = 'default';
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkK8SQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        delete process.env.POD_NAMESPACE;
        expect(next).to.have.been.calledOnce.calledWithExactly()
      });
  });
  it('CF platform, org id undefined, should call next with BadRequest', () => {
    req.body = CFContextBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.not.have.been.called;
    expect(next).to.have.been.calledOnce;
    expect(next.getCall(0).args[0] instanceof BadRequest);
  });
  it('Quota not entitled, should call next with Forbidden', () => {
    req.body = notEntitledBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        expect(next).to.have.been.calledOnce;
        expect(next.getCall(0).args[0] instanceof Forbidden);
      });
  });
  it('Quota invalid, should call next with Forbidden', () => {
    req.body = invalidQuotaBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        expect(next).to.have.been.calledOnce;
        expect(next.getCall(0).args[0] instanceof Forbidden);
      });
  });
  it('Quota valid, should call next', () => {
    req.body = validQuotaBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly());
  });
  it('SMCF platform, Quota valid, should call next', () => {
    req.body = SMCFContextBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly());
  });

  it('SMK8S platform, Quota valid, should call next', () => {
    req.body = SMK8SContextBody;
    process.env.POD_NAMESPACE = 'default';
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkK8SQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => {
        delete process.env.POD_NAMESPACE;
        expect(next).to.have.been.calledOnce.calledWithExactly()
      });
  });

  it('Quota funtion throws error, should call next with error', () => {
    checkQuotaStub.withArgs(organization_guid, errQuotaPlanId, undefined, 'PATCH').returns(Promise.reject(err));
    req.body = errQuotaBody;
    checkQuota(req, res, next);
    expect(isServiceFabrikOperationStub).to.have.been.calledOnce;
    expect(checkQuotaStub).to.have.been.called;
    return Promise.delay(PROMISE_WAIT_SIMULATED_DELAY)
      .then(() => expect(next).to.have.been.calledOnce.calledWithExactly(err));
  });
});