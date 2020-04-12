'use strict';

const proxyquire = require('proxyquire').noPreserveCache();
const path = require('path');

const text = `my
line1
line2
`;
const actual = `my
line1
line2`;
const filename = 'tempfile';

describe('utils', () => {
  describe('RsaKeyGenerator', () => {
    let spawnStub = () => {
      return {
        on: (code, fn) => {
          fn(code);
        }
      };
    };
    let KeyGenSubject, KeyGenSubjectFailure, KeyGenSubjectFailure2;
    let subject, failSubject, failSubject2;
    let fileAvailableSpy, failFileAvailableSpy;
    let fsStub = {
      access: (file, cb) => {
        cb(null);
      },
      unlink: (file, cb) => {
        cb(null);
      },
      readFile: (file, encoding, cb) => {
        cb(null, text);
      }
    };
    let fsFailStub = {
      access: (file, cb) => {
        cb(file);
      },
      unlink: (file, cb) => {
        cb(file);
      },
      readFile: (file, encoding, cb) => {
        cb(file + encoding);
      }
    };
    let fsFailStub2 = {
      access: (file, cb) => {
        cb(null);
      },
      unlink: (file, cb) => {
        cb(file);
      },
      readFile: (file, encoding, cb) => {
        cb(file + encoding);
      }
    };
    before(() => {
      KeyGenSubjectFailure2 = proxyquire('../../common/utils/RsaKeyGenerator', {
        'uuid': {
          v4: () => 'abcd'
        },
        'fs': fsFailStub2,
        'os': {
          tmpdir: () => __dirname
        }
      });
      KeyGenSubjectFailure = proxyquire('../../common/utils/RsaKeyGenerator', {
        'uuid': {
          v4: () => 'abcd'
        },
        'fs': fsFailStub,
        'os': {
          tmpdir: () => __dirname
        },
        'child_process': {
          spawn: spawnStub
        }
      });
      KeyGenSubject = proxyquire('../../common/utils/RsaKeyGenerator', {
        'uuid': {
          v4: () => 'abcd'
        },
        'fs': fsStub,
        'os': {
          tmpdir: () => __dirname
        },
        'child_process': {
          spawn: spawnStub
        }
      });
    });
    after(() => {
      proxyquire.preserveCache();
    });

    beforeEach(() => {
      subject = new KeyGenSubject(user);
      failSubject = new KeyGenSubjectFailure(user);
      failSubject2 = new KeyGenSubjectFailure2(user);
      fileAvailableSpy = sinon.spy(subject, 'isFileAvailable');
      failFileAvailableSpy = sinon.spy(failSubject, 'isFileAvailable');
    });
    afterEach(() => {
      fileAvailableSpy.restore();
      failFileAvailableSpy.restore();
    });
    const user = 'usercomment';
    it('should set up file paths properly', () => {
      expect(subject.user).to.eql(user);
      expect(subject.location).to.eql(path.join(__dirname, 'id_rsa_abcd'));
      expect(subject.pubFile).to.eql(path.join(__dirname, 'id_rsa_abcd.pub'));
    });
    it('should return true when file is available', () => {
      return subject.isFileAvailable(filename)
        .then(av => {
          expect(av).to.eql(true);
        });
    });
    it('should return false when file is unavailable', () => {
      return failSubject.isFileAvailable(filename)
        .then(av => {
          expect(av).to.eql(false);
        });
    });
    it('should run successfully when force deletion is properly done', () => {
      return subject.forceDeleteFiles()
        .then(() => {
          expect(fileAvailableSpy.callCount).to.eql(2);
          expect(fileAvailableSpy.firstCall.args[0]).to.eql(subject.location);
          expect(fileAvailableSpy.secondCall.args[0]).to.eql(subject.pubFile);
        });
    });
    it('should run successfully when force deletion has nothing to do', () => {
      return failSubject.forceDeleteFiles()
        .then(() => {
          expect(failFileAvailableSpy.callCount).to.eql(2);
          expect(failFileAvailableSpy.firstCall.args[0]).to.eql(subject.location);
          expect(failFileAvailableSpy.secondCall.args[0]).to.eql(subject.pubFile);
        });
    });
    it('should fail when force deletion fails', () => {
      return failSubject2.forceDeleteFiles()
        .catch((err) => {
          expect(err.message).to.eql(failSubject2.location);
        });
    });
    it('should pass when ssh-keygen is invoked', () => {
      return subject.runSshKeygen()
        .then((msg) => {
          expect(msg).to.eql('exit');
        });
    });
    it('should fail on create key pair when read file fails', () => {
      return failSubject.createKeyPair()
        .catch((err) => {
          expect(err.message).to.eql(failSubject.location + 'utf8');
        });
    });
    it('should return public key and private key on successful key pair generation', () => {
      return subject.createKeyPair()
        .then((obj) => {
          expect(obj.privateKey).to.eql(actual);
          expect(obj.publicKey).to.eql(actual);
        });
    });
  });
});