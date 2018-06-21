'use strict';

const {
  Etcd3,
  EtcdLockFailedError
} = require('etcd3');

const config = require('../config');
const logger = require('../logger');

function etcdConnector() {
  const client = new Etcd3({
    hosts: config.etcd.url,
    credentials: {
      rootCertificate: Buffer.from(config.etcd.ssl.ca, 'utf8'),
      privateKey: Buffer.from(config.etcd.ssl.key, 'utf8'),
      certChain: Buffer.from(config.etcd.ssl.crt, 'utf8')
    }
  });
  return client;
}
const time_minute = (1 * 60 * 1000);

class LockStatusPoller {
  constructor(opts) {
    this.timeInterval = opts.time_interval || time_minute;
    this.lock = null;
  }

  /**
   * Name of the lock resource for the timer
   */
  get lockName() {
    return `pollers/${this.constructor.name}`;
  }

  /**
   * Gets the interval object created by the NodeJS engine for the interval timer
   */
  get timer() {
    return this.interval;
  }

  /**
   * Fetches the current etcd lock
   */
  get currentLock() {
    return this.lock;
  }

  /**
   * Abstract function to be implemented by subclasses
   * This function must return a Bluebird promise
   */
  action() {
    throw new Error('Not implemented in subclass');
  }

  /**
   * Starts the timer
   */
  start() {
    if (this.interval) {
      throw new Error('timer already started');
    }
    this.interval = setInterval(() => {
      const lock = etcdConnector().lock(this.lockName);
      lock.do(() => {
          this.lock = lock;
          return this.action();
        })
        .catch(EtcdLockFailedError, err => logger.error(`Locking on resource ${this.lockName} failed. Retry should be triggered on next run`, err))
        .catch(err => logger.error('Error in processing action', err));
    }, this.timeInterval);
  }

  /**
   * Stops the timer and forcibly releases the lock, if any
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.currentLock) {
      //forcibly release the lock when the timer is stopped
      this.currentLock.release()
        .catch(() => undefined);
    }
  }
}

module.exports = LockStatusPoller;