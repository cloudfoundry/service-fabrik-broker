'use strict';

const errors = require('../../deployment_hooks/lib/errors');
const proxyquire = require('proxyquire');

describe('action', function () {
  describe('JSExecutor', function () {
    let sandbox, processExitStub, initialProcessArgv, proxyLibs, consoleErrorStub;
    before(function () {
      sandbox = sinon.createSandbox();
    });
    beforeEach(function () {
      processExitStub = sandbox.stub(process, 'exit');
      consoleErrorStub = sandbox.stub(console, 'error');
      initialProcessArgv = process.argv;
      process.argv = [];
    });
    afterEach(function () {
      processExitStub.reset();
      processExitStub.restore();
      consoleErrorStub.reset();
      consoleErrorStub.restore();
      process.argv = initialProcessArgv;
    });
    it('should print correct action response', function () {
      proxyLibs = {};
      process.argv[2] = 'ReserveIps';
      process.argv[3] = 'PreCreate';
      process.argv[4] = '{}';
      return proxyquire('../../deployment_hooks/lib/actions/JSExecutor', proxyLibs)
        .then(() => {
          expect(consoleErrorStub.callCount).to.equal(0);
          expect(processExitStub.callCount).to.equal(0);
        });
    });
    it('should throw error', function () {
      proxyLibs = {
        './js/ReserveIps': {
          'executePreCreate': function () {
            throw new errors.InternalServerError(`error in script`);
          }
        }
      };
      process.argv[2] = 'ReserveIps';
      process.argv[3] = 'PreCreate';
      process.argv[4] = 'context';
      return proxyquire('../../deployment_hooks/lib/actions/JSExecutor', proxyLibs)
        .then(() => {
          expect(consoleErrorStub.callCount).to.equal(2);
          expect(processExitStub.callCount).to.equal(1);
        });
    });
    it('should exit if args are invalid', function () {
      proxyLibs = {};
      process.argv[2] = 'ReserveIps';
      return proxyquire('../../deployment_hooks/lib/actions/JSExecutor', proxyLibs)
        .then(() => {
          expect(consoleErrorStub.callCount).to.equal(1);
          expect(processExitStub.callCount).to.equal(1);
        });
    });
  });
});