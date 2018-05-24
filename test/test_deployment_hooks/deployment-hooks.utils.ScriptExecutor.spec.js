'use strict';

const fs = require('fs');
const path = require('path');
const ScriptExecutor = require('../../deployment_hooks/lib/utils/ScriptExecutor');
describe('deployment_hooks', function () {
  describe('utils', function () {
    describe('#ScriptExecuter', function () {
      it('should throw not found if path does not exist', function () {
        let actionScriptAbsPath = 'randompath';
        try {
          /*jshint unused:false*/
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