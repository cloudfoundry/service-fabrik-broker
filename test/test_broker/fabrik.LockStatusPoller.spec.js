'use strict';

const {
  Etcd3,
  EtcdLockFailedError,
  EtcdLeaseInvalidError
} = require('etcd3');
const LockStatusPoller = require('../../broker/lib/fabrik/LockStatusPoller');

class LockStubber {
  constructor(lockName, acquire, releaseError) {
    this.lockName = lockName;
    this.gotLock = acquire;
    this.releaseError = releaseError;
    this.releaseCalled = false;
  }
  do(fn) {
    return this.acquire()
      .then(() => {
        return Promise.try(() => {
          return fn();
        }).catch(() => {});
      }).catch(err => {
        throw err;
      });
  }
  acquire() {
    if (this.gotLock === 0) {
      return Promise.resolve();
    } else if (this.gotLock === 1) {
      return Promise.reject(new EtcdLockFailedError('Etcd Lock Error'));
    } else {
      return Promise.reject(new EtcdLeaseInvalidError('Etcd Lease Invalid'));
    }
  }
  release() {
    this.releaseCalled = true;
    if (this.releaseError) {
      return Promise.reject(new Error('Lock release error'));
    }
    return Promise.resolve();
  }
}

describe('fabrik', function () {
  describe('LockStatusPoller', function () {
    let sandbox, clock, lockSpy, actionSpy;
    let sub;
    let timeInterval = 1 * 60 * 1000;
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
      clock = sinon.useFakeTimers();
      sub = new LockStatusPoller({
        time_interval: timeInterval
      });
    });
    afterEach(() => {
      clock.restore();
      sandbox.restore();
    });
    it('should call start to acquire lock and start the timer', () => {
      lockSpy = sandbox.stub(Etcd3.prototype, 'lock', (lock) => new LockStubber(lock, 0));
      actionSpy = sandbox.stub(LockStatusPoller.prototype, 'action', () => Promise.resolve());
      sub.start();
      clock.tick(timeInterval);
      clock.restore();
      return Promise.delay(100).then(() => {
        expect(lockSpy.calledOnce).to.eql(true);
        expect(actionSpy.calledOnce).to.eql(true);
      });
    });
    it('should continue the timer irrespective of action call errors', () => {
      lockSpy = sandbox.stub(Etcd3.prototype, 'lock', (lock) => new LockStubber(lock, 0));
      actionSpy = sandbox.stub(LockStatusPoller.prototype, 'action', () => Promise.reject(new Error('action_error')));
      sub.start();
      clock.tick(timeInterval);
      clock.tick(timeInterval);
      clock.restore();
      return Promise.delay(100).then(() => {
        expect(lockSpy.callCount).to.eql(2);
        expect(actionSpy.callCount).to.eql(2);
      });
    });
    it('should continue the timer irrespective of lock acquisition errors', () => {
      lockSpy = sandbox.stub(Etcd3.prototype, 'lock', (lock) => new LockStubber(lock, 1));
      actionSpy = sandbox.stub(LockStatusPoller.prototype, 'action', () => Promise.resolve());
      sub.start();
      clock.tick(timeInterval);
      clock.tick(timeInterval);
      clock.restore();
      return Promise.delay(100).then(() => {
        expect(lockSpy.callCount).to.eql(2);
        expect(actionSpy.callCount).to.eql(0);
      });
    });
    it('should continue the timer irrespective of lock lease invalid errors', () => {
      lockSpy = sandbox.stub(Etcd3.prototype, 'lock', (lock) => new LockStubber(lock, 2));
      actionSpy = sandbox.stub(LockStatusPoller.prototype, 'action', () => Promise.resolve());
      sub.start();
      clock.tick(timeInterval);
      clock.tick(timeInterval);
      clock.restore();
      return Promise.delay(100).then(() => {
        expect(lockSpy.callCount).to.eql(2);
        expect(actionSpy.callCount).to.eql(0);
      });
    });
    it('should start the timer and invoke action multiple times', () => {
      lockSpy = sandbox.stub(Etcd3.prototype, 'lock', (lock) => new LockStubber(lock, 0));
      actionSpy = sandbox.stub(LockStatusPoller.prototype, 'action', () => Promise.resolve());
      sub.start();
      clock.tick(timeInterval);
      clock.tick(timeInterval);
      clock.restore();
      return Promise.delay(100).then(() => {
        expect(lockSpy.callCount).to.eql(2);
        expect(actionSpy.callCount).to.eql(2);
      });
    });
    it('should not allow multiple starts', () => {
      lockSpy = sandbox.stub(Etcd3.prototype, 'lock', (lock) => new LockStubber(lock, 0));
      actionSpy = sandbox.stub(LockStatusPoller.prototype, 'action', () => Promise.resolve());
      sub.start();
      try {
        sub.start();
      } catch (err) {
        expect(err.message).to.eql('timer already started');
      }
    });
    it('should stop timer successfully', () => {
      let stubber;
      lockSpy = sandbox.stub(Etcd3.prototype, 'lock', lock => {
        stubber = new LockStubber(lock, 0);
        return stubber;
      });
      actionSpy = sandbox.stub(LockStatusPoller.prototype, 'action', () => Promise.resolve());
      sub.start();
      clock.tick(timeInterval);
      sub.stop();
      expect(sub.interval).to.eql(undefined);
      clock.tick(timeInterval);
      clock.restore();
      return Promise.delay(100).then(() => {
        expect(lockSpy.callCount).to.eql(1);
        expect(actionSpy.callCount).to.eql(1);
      });
    });
  });
});