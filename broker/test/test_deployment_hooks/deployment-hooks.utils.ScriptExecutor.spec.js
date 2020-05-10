'use strict';

const fs = require('fs');
const path = require('path');
const proxyquire = require('proxyquire');
const ScriptExecutor = require('../../applications/deployment_hooks/lib/utils/ScriptExecutor');
describe('deployment_hooks', function () {
  describe('utils', function () {
    describe('#ScriptExecuter', function () {
      it('should throw not found if path does not exist', function () {
        let actionScriptAbsPath = 'randompath';
        try {
          /* jshint unused:false*/
          let executor = new ScriptExecutor(actionScriptAbsPath);
        } catch (err) {
          expect(err).to.have.status(404);
        }
      });
    });
    describe('#execute', function () {
      it('should execute script successfully with json formatted output', function () {
        let actionScriptAbsPath = path.join(__dirname, 'testfile');
        fs.writeFileSync(actionScriptAbsPath, 'echo \'{\"foo\":\"bar\"}\'\nexit 0', {
          mode: 0o755
        });
        let executor = new ScriptExecutor(actionScriptAbsPath);
        const expectedResponse = {
          foo: 'bar'
        };
        return executor.execute()
          .then(response => {
            fs.unlinkSync(actionScriptAbsPath);
            expect(response).to.deep.equal(expectedResponse);
          });
      });

      it('should execute script successfully with seccomp enabled', function () {
        const testScriptExecutor = proxyquire('../../applications/deployment_hooks/lib/utils/ScriptExecutor', {
          '../config': {
            enable_syscall_filters: true,
            whitelisted_syscalls: 'read'
          },
          'child_process': {
            exec: function (command, callback) {
              callback(null, 'result');
            }
          }
        });
        let executor = new testScriptExecutor();
        return executor.execute()
          .then(response => {
            expect(response).to.deep.equal('result');
          });
      });

      it('should execute script successfully with non json formatted output', function () {
        const args = {
          foo: 'bar'
        };
        let actionScriptAbsPath = path.join(__dirname, 'testfile');
        fs.writeFileSync(actionScriptAbsPath, 'echo \'input args: \'$@\nexit 0', {
          mode: 0o755
        });
        let executor = new ScriptExecutor(actionScriptAbsPath);
        const expectedResponse = 'input args: {\"foo\":\"bar\"}\n';
        return executor.execute(args)
          .then(response => {
            fs.unlinkSync(actionScriptAbsPath);
            expect(response).to.deep.equal(expectedResponse);
          });
      });
      it('should throw error if script exits with non zero exit status', function () {
        let actionScriptAbsPath = path.join(__dirname, 'testfile');
        fs.writeFileSync(actionScriptAbsPath, 'echo error response\nexit 1', {
          mode: 0o755
        });
        let executor = new ScriptExecutor(actionScriptAbsPath);
        return executor.execute()
          .then(() => fs.unlinkSync(actionScriptAbsPath))
          .catch(err => {
            fs.unlinkSync(actionScriptAbsPath);
            expect(err).to.have.status(500);
            expect(err.description).to.eql('error response\n');
          });
      });
    });
  });
});
