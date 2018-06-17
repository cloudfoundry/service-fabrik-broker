'use strict';

const Promise = require('bluebird');
const manager = require('../../eventmesh').etcdLockManager;
const CONST = require('../../eventmesh/constants');

const {
  Etcd3
} = require('etcd3');

describe('eventmesh', () => {
  describe('LockManager', () => {
    let sandbox, valueStub, acquireStub, releaseStub, jsonStub, putStub, getStub, lockStub;
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
      valueStub = sandbox.stub();
      acquireStub = sandbox.stub();
      releaseStub = sandbox.stub();
      jsonStub = sandbox.stub();
      putStub = sandbox.stub(Etcd3.prototype, 'put', () => {
        return {
          value: (val) => Promise.resolve(valueStub(val))
        };
      });
      getStub = sandbox.stub(Etcd3.prototype, 'get', () => {
        return {
          json: () => Promise.resolve(jsonStub())
        };
      });
      lockStub = sandbox.stub(Etcd3.prototype, 'lock', () => {
        return {
          ttl: () => {
            return {
              acquire: () => Promise.resolve(acquireStub())
            };
          },
          release: () => Promise.resolve(releaseStub())
        };
      });
    });

    afterEach(function () {
      sandbox.restore();
    });

    describe('#isWriteLocked', () => {
      it('should return false in case the resource has no lock', () => {
        return manager.isWriteLocked('fakeResource')
          .then(result => {
            /* jshint expr: true */
            expect(result).to.eql(false);
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
          });
      });
      it('should return true for a write lock.', () => {
        const writeLockResp = {
          'count': 1,
          'operationType': 'WRITE'
        };
        jsonStub.onCall(0).returns(writeLockResp);
        return manager.isWriteLocked('fakeResource')
          .then(result => {
            /* jshint expr: true */
            expect(result).to.eql(true);
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
          });
      });
      it('should return false for a read lock.', () => {
        const readLockResp = {
          'count': 1,
          'operationType': 'READ'
        };
        jsonStub.onCall(0).returns(readLockResp);
        return manager.isWriteLocked('fakeResource')
          .then(result => {
            /* jshint expr: true */
            expect(result).to.eql(false);
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
          });
      });
      it('should return false for a no lock.', () => {
        const noLockResp = {
          'count': 0,
          'operationType': ''
        };
        jsonStub.onCall(0).returns(noLockResp);
        return manager.isWriteLocked('fakeResource')
          .then(result => {
            /* jshint expr: true */
            expect(result).to.eql(false);
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
          });
      });
    });

    describe('#lock', () => {
      it('should succeed when lock details is undefined.', () => {
        const writeLockResp = {
          'count': 1,
          'operationType': 'WRITE'
        };
        return manager.lock('fakeResource', CONST.ETCD.LOCK_TYPE.WRITE)
          .then(() => {
            /* jshint expr: true */
            expect(lockStub.getCall(0).calledWithExactly('fakeResource/lock')).to.be.true;
            expect(putStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly(JSON.stringify(writeLockResp))).to.be.true;
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(acquireStub.called).to.be.true;
            expect(releaseStub.called).to.be.true;
            sinon.assert.calledOnce(releaseStub);
          });
      });
      it('should succeed if no ongoing lock is there.', () => {
        const noLockResp = {
          'count': 0,
          'operationType': ''
        };
        const writeLockResp = {
          'count': 1,
          'operationType': 'WRITE'
        };
        jsonStub.onCall(0).returns(noLockResp);
        return manager.lock('fakeResource', CONST.ETCD.LOCK_TYPE.WRITE)
          .then(() => {
            /* jshint expr: true */
            expect(lockStub.getCall(0).calledWithExactly('fakeResource/lock')).to.be.true;
            expect(putStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly(JSON.stringify(writeLockResp))).to.be.true;
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(acquireStub.called).to.be.true;
            expect(releaseStub.called).to.be.true;
            sinon.assert.calledOnce(releaseStub);
          });
      });
      it('should fail if an ongoing lock is there.', () => {
        const writeLockResp = {
          'count': 1,
          'operationType': 'WRITE'
        };
        jsonStub.onCall(0).returns(writeLockResp);
        return manager.lock('fakeResource', CONST.ETCD.LOCK_TYPE.WRITE)
          .catch(e => {
            /* jshint expr: true */
            expect(e.message).to.eql('Could not acquire lock for fakeResource as it is already locked.');
            expect(lockStub.getCall(0).calledWithExactly('fakeResource/lock')).to.be.true;
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(acquireStub.called).to.be.true;
            expect(releaseStub.called).to.be.true;
            sinon.assert.calledOnce(releaseStub);
          });
      });
      it('should not fail even if release of resource lock fails.', () => {
        const noLockResp = {
          'count': 0,
          'operationType': ''
        };
        jsonStub.onCall(0).returns(noLockResp);
        releaseStub.onCall(0).throws(new Error('Failed for release lock'));
        return manager.lock('fakeResource', CONST.ETCD.LOCK_TYPE.WRITE)
          .then(() => {
            /* jshint expr: true */
            expect(lockStub.getCall(0).calledWithExactly('fakeResource/lock')).to.be.true;
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(acquireStub.called).to.be.true;
            expect(releaseStub.called).to.be.true;
            sinon.assert.calledOnce(releaseStub);
            expect(putStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
          });
      });
      it('should fail if put fails.', () => {
        const noLockResp = {
          'count': 0,
          'operationType': ''
        };
        jsonStub.onCall(0).returns(noLockResp);
        valueStub.onCall(0).throws(new Error('Failed for set lock details.'));
        return manager.lock('fakeResource', CONST.ETCD.LOCK_TYPE.WRITE)
          .catch(e => {
            /* jshint expr: true */
            expect(e.message).to.eql('Failed for set lock details.');
            expect(lockStub.getCall(0).calledWithExactly('fakeResource/lock')).to.be.true;
            expect(getStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(acquireStub.called).to.be.true;
            expect(releaseStub.called).to.be.false; // we are not calling release explicitly here, after 5 seconds it will get released automatically.
          });
      });
    });
    describe('#unlock', () => {
      it('should succeed.', () => {
        const noLockResp = {
          'count': 0,
          'operationType': ''
        };
        return manager.unlock('fakeResource')
          .then(() => {
            /* jshint expr: true */
            expect(putStub.getCall(0).calledWithExactly('fakeResource/lock/details')).to.be.true;
            expect(valueStub.getCall(0).calledWithExactly(JSON.stringify(noLockResp))).to.be.true;
            expect(acquireStub.called).to.be.false;
            expect(releaseStub.called).to.be.false;
          });
      });
    });
  });
});