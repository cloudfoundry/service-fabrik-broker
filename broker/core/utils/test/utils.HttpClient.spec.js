'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const CommandsFactory = require('hystrixjs').commandFactory;

const responseBody = 'this-is-the-response-body';
const responseObject = {
  statusCode: 200,
  statusMessage: 'HTTP_Status_Message',
  headers: []
};
const expectedResultObject = _.assign({}, responseObject, {
  body: responseBody
});

const HttpClient = proxyquire('../src/HttpClient', {
  bluebird: {
    promisify(fun) {
      return fun;
    }
  },
  request: {
    defaults(options) {
      return function () {
        return Promise.resolve([
          _.update(_.assign({}, responseObject), 'statusCode', () => {
            return options.respondWithStatusCode || 200;
          }),
          options.respondWithBody || responseBody
        ]);
      };
    }
  }
});

describe('utils', () => {
  describe('HttpClient', () => {
    /* jshint expr:true */
    let httpClient = new HttpClient({});

    describe('request', () => {
      it('returns request result (no error occured)', done => {
        let responseStatus = 200;
        httpClient.request({
          expectedStatusCode: responseStatus
        }).then(res => {
          expect(res).to.eql(expectedResultObject);
          done();
        }).catch(done);
      });

      it('returns request result (no error occured) (no expectedStatusCode)', done => {
        let responseStatus = 200;
        httpClient.request({
          expectedStatusCode: responseStatus
        }).then(res => {
          expect(res).to.eql(expectedResultObject);
          done();
        }).catch(done);
      });

      it('throws a BadRequest error', done => {
        let responseStatus = 400;
        new HttpClient({
          respondWithStatusCode: responseStatus
        }).request({}, 200)
          .then(done)
          .catch(err => {
            expect(err.status).to.equal(responseStatus);
            done();
          });
      });

      it('throws a NotFound error', done => {
        let responseStatus = 404;
        new HttpClient({
          respondWithStatusCode: responseStatus
        }).request({}, 200)
          .then(done)
          .catch(err => {
            expect(err.status).to.equal(responseStatus);
            done();
          });
      });

      it('throws an InternalServerError error', done => {
        let responseStatus = 500;
        new HttpClient({
          respondWithStatusCode: responseStatus,
          respondWithBody: {}
        }).request({}, 200)
          .then(done)
          .catch(err => {
            expect(err.status).to.equal(responseStatus);
            expect(err).to.have.property('error');
            done();
          });
      });
    });

    describe('circuit breaker', function () {
      class Command {
        circuitBreakerErrorThresholdPercentage() {}
        timeout() {}
        run() {}
        circuitBreakerRequestVolumeThreshold() {}
        circuitBreakerSleepWindowInMilliseconds() {}
        statisticalWindowLength() {}
        statisticalWindowNumberOfBuckets() {}
        errorHandler() {}
        build() {}
        execute() {}
      }
      const apiConfig = {
        name: 'Bosh',
        sleep_window_in_ms: 30000,
        statistical_window_length: 5000,
        api_overrides: {
          GET: {
            error_threshold_percentage: 29,
            sleep_window_in_ms: 120000,
            request_volume_threshold: 3,
            method_overrides: {
              '/deployments': {
                error_threshold_percentage: 19,
                sleep_window_in_ms: 10000,
                statistical_window_length: 1000,
                service_timeout: 9999
              }
            }
          }
        }
      };
      const baseUrl = 'https://192.168.50.4:25555';
      const config = {
        log_level: 'silly',
        enable_circuit_breaker: true,
        circuit_breaker: {
          http: {
            error_threshold_percentage: 49,
            service_timeout: 180000,
            request_volume_threshold: 10,
            sleep_window_in_ms: 120000,
            statistical_window_number_of_buckets: 10,
            statistical_window_length: 2000,
            apis: {
              'https://192.168.50.4:25555': apiConfig
            }
          }
        }
      };
      const httpHandler = function (options) {
        options = options || {};
        return Promise.resolve([
          _.update(_.assign({}, responseObject), 'statusCode', () => {
            return options.respondWithStatusCode || 200;
          }),
          options.respondWithBody || responseBody
        ]);
      };
      const httpClientWithCircuitBreaker = proxyquire('../src/HttpClient', {
        bluebird: {
          promisify(fun) {
            return fun;
          }
        },
        '@sf/app-config': config,
        request: {
          defaults(options) {
            return () => httpHandler(options);
          }
        }
      });
      let sandbox, commandFactoryStub, commandStub;
      before(function () {
        sandbox = sinon.createSandbox();
        commandStub = sandbox.stub(Command.prototype);
        commandFactoryStub = sandbox.stub(CommandsFactory, 'getOrCreate');
        const cmd = new Command();
        commandFactoryStub.withArgs().returns(cmd);
        commandStub.circuitBreakerErrorThresholdPercentage.withArgs().returns(cmd);
        commandStub.timeout.withArgs().returns(cmd);
        commandStub.run.withArgs().returns(cmd);
        commandStub.circuitBreakerRequestVolumeThreshold.withArgs().returns(cmd);
        commandStub.circuitBreakerSleepWindowInMilliseconds.withArgs().returns(cmd);
        commandStub.statisticalWindowLength.withArgs().returns(cmd);
        commandStub.statisticalWindowNumberOfBuckets.withArgs().returns(cmd);
        commandStub.errorHandler.withArgs().returns(cmd);
        commandStub.build.withArgs().returns(cmd);
        commandStub.execute = options => {
          return httpHandler(options)
            .spread((res, body) => {
              const result = {
                statusCode: res.statusCode,
                statusMessage: res.statusMessage,
                headers: res.headers,
                body: body
              };
              return result;
            });
        };
      });
      afterEach(function () {
        commandFactoryStub.resetHistory();
        commandStub.circuitBreakerErrorThresholdPercentage.resetHistory();
        commandStub.timeout.resetHistory();
        commandStub.run.resetHistory();
        commandStub.circuitBreakerRequestVolumeThreshold.resetHistory();
        commandStub.circuitBreakerSleepWindowInMilliseconds.resetHistory();
        commandStub.statisticalWindowLength.resetHistory();
        commandStub.statisticalWindowNumberOfBuckets.resetHistory();
        commandStub.errorHandler.resetHistory();
        commandStub.build.resetHistory();
      });

      after(function () {
        sandbox.restore();
      });

      function assertResponse(httpClient) {
        // Validate base circuit configurations
        const cmdBaseKey = `${baseUrl}_base_circuit`;
        expect(commandFactoryStub).to.have.been.calledThrice;
        expect(commandFactoryStub.firstCall.args[0]).to.eql(cmdBaseKey);
        expect(commandFactoryStub.firstCall.args[1]).to.eql('Bosh');
        expect(commandStub.circuitBreakerErrorThresholdPercentage.firstCall.args[0]).to.eql(49);
        expect(commandStub.timeout.firstCall.args[0]).to.eql(180000);
        expect(typeof commandStub.run.firstCall.args[0] === 'function').to.be.true;
        expect(commandStub.circuitBreakerRequestVolumeThreshold.firstCall.args[0]).to.eql(10);
        expect(commandStub.circuitBreakerSleepWindowInMilliseconds.firstCall.args[0]).to.eql(30000);
        expect(commandStub.statisticalWindowLength.firstCall.args[0]).to.eql(5000);
        expect(commandStub.statisticalWindowNumberOfBuckets.firstCall.args[0]).to.eql(10);
        expect(typeof commandStub.errorHandler.firstCall.args[0] === 'function').to.be.true;
        // Validate HTTP method level circuit configurations
        const cmdApiOverRideKey = `${baseUrl}_get_circuit`;
        expect(commandFactoryStub.secondCall.args[0]).to.eql(cmdApiOverRideKey);
        expect(commandFactoryStub.secondCall.args[1]).to.eql('Bosh');
        expect(commandStub.circuitBreakerErrorThresholdPercentage.secondCall.args[0]).to.eql(29);
        expect(commandStub.timeout.secondCall.args[0]).to.eql(180000);
        expect(typeof commandStub.run.secondCall.args[0] === 'function').to.be.true;
        expect(commandStub.circuitBreakerRequestVolumeThreshold.secondCall.args[0]).to.eql(3);
        expect(commandStub.circuitBreakerSleepWindowInMilliseconds.secondCall.args[0]).to.eql(120000);
        expect(commandStub.statisticalWindowLength.secondCall.args[0]).to.eql(5000);
        expect(commandStub.statisticalWindowNumberOfBuckets.secondCall.args[0]).to.eql(10);
        expect(typeof commandStub.errorHandler.secondCall.args[0] === 'function').to.be.true;
        // validate indivdual HTTP method override configuration even at PATH URL level
        const cmdMethodOverRideKey = `${baseUrl}_get_/deployments_circuit`;
        expect(commandFactoryStub.thirdCall.args[0]).to.eql(cmdMethodOverRideKey);
        expect(commandFactoryStub.thirdCall.args[1]).to.eql('Bosh');
        expect(commandStub.circuitBreakerErrorThresholdPercentage.thirdCall.args[0]).to.eql(19);
        expect(commandStub.timeout.thirdCall.args[0]).to.eql(9999);
        expect(typeof commandStub.run.thirdCall.args[0] === 'function').to.be.true;
        expect(commandStub.circuitBreakerRequestVolumeThreshold.thirdCall.args[0]).to.eql(3);
        expect(commandStub.circuitBreakerSleepWindowInMilliseconds.thirdCall.args[0]).to.eql(10000);
        expect(commandStub.statisticalWindowLength.thirdCall.args[0]).to.eql(1000);
        expect(commandStub.statisticalWindowNumberOfBuckets.thirdCall.args[0]).to.eql(10);
        expect(typeof commandStub.errorHandler.thirdCall.args[0] === 'function').to.be.true;
        const cmdKeys = _.keys(httpClient.commandMap['https://192.168.50.4:25555']);
        expect(cmdKeys.length === 3).to.be.true;
        expect(_.intersection(cmdKeys, ['BASE_CMD', cmdApiOverRideKey, cmdMethodOverRideKey]).length === 3).to.be.true;
      }

      it('builds circuit breaker config for the configured Base URL, HTTP method & specific path', function () {
        const httpClient = new httpClientWithCircuitBreaker({
          baseUrl: 'https://192.168.50.4:25555',
          auth: {
            user: 'admin',
            pass: 'admin'
          }
        });
        assertResponse(httpClient);
      });

      it('builds circuit breaker config at the time of request', function (done) {
        const httpClient = new httpClientWithCircuitBreaker();
        // Validate base circuit configurations
        expect(commandFactoryStub).not.to.be.called;
        let responseStatus = 200;
        httpClient.request({
          url: 'https://192.168.50.4:25555/deployments',
          method: 'GET',
          expectedStatusCode: responseStatus
        }).then(res => {
          expect(res).to.eql(expectedResultObject);
          assertResponse(httpClient);
          done();
        }).catch(done);
      });
    });
  });
});
