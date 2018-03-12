'use strict';

const fs = require('fs');
const path = require('path');
const ScriptExecutor = require('../lib/utils/ScriptExecutor');

describe('utils', function () {
  describe('#ScriptExecuter', function () {
    it('should throw not found if path does not exist', function () {
      let actionScriptAbsPath = 'raendompath';
      try {
        /*jshint unused:false*/
        let executor = new ScriptExecutor(actionScriptAbsPath);
      } catch (err) {
        expect(err).to.have.status(404);
      }
    });
  });
  describe('#execute', function () {
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