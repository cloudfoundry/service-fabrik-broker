'use strict';

const nock = require('nock');
const path = require('path');
const fs = require('fs');

class Recorder {
  constructor(name) {
    this.filename = path.join(__dirname, '..', 'fixtures', `${name}.js`);
    this.hasFixtures = !!process.env.NOCK_RECORD;
  }

  before() {
    if (!this.hasFixtures) {
      try {
        require(this.filename);
        this.hasFixtures = true;
      } catch (err) {
        console.error(err);
        nock.recorder.rec({
          dont_print: true
        });
      }
    } else {
      this.hasFixtures = false;
      nock.recorder.rec({
        dont_print: true
      });
    }
  }

  after() {
    if (!this.hasFixtures) {
      const fixtures = nock.recorder.play();
      fixtures.unshift('\'use strict\';', 'const nock = require(\'nock\');');
      fs.writeFileSync(this.filename, fixtures.join('\n'));
    }
  }

  static record(name) {
    const recorder = new Recorder(name);
    return {
      before: () => {
        recorder.before();
      },
      after: () => {
        recorder.after();
      }
    };
  }
}

module.exports = Recorder;