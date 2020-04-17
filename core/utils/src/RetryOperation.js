'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const errors = require('./errors');
const Timeout = errors.Timeout;

class RetryOperation {
  constructor(options) {
    _.assign(this, {
      maxAttempts: 10,
      timeout: Infinity,
      factor: 2,
      minDelay: 1174, // last attempt after 10 min
      maxDelay: Infinity
    }, options);
  }

  predicate(err) {
    /* jshint unused:false */
    return true;
  }

  backoff(tries) {
    if (tries > 0) {
      return Math.min(this.minDelay * Math.pow(this.factor, tries - 1), this.maxDelay);
    }
    return 0;
  }

  retry(fn) {
    const self = this;
    const retryStart = Date.now();
    let tries = 0;

    function attempt() {
      const attemptStart = Date.now();
      return Promise
        .try(() => {
          return fn(tries);
        })
        .catch(self.predicate, err => {
          const now = Date.now();
          const delay = Math.max(self.backoff(++tries) - (now - attemptStart), 0);
          const time = now + delay - retryStart;
          if (tries >= self.maxAttempts) {
            return Promise.reject(Timeout.toManyAttempts(tries, err, self.operation));
          }
          if (time >= self.timeout) {
            return Promise.reject(Timeout.timedOut(time, err, self.operation));
          }
          if (delay > 0) {
            return Promise.delay(delay).then(attempt);
          }
          return attempt();
        });
    }
    return attempt();
  }

  static create(options) {
    return new RetryOperation(options);
  }

  static retry(fn, options) {
    return RetryOperation.create(options).retry(fn);
  }
}

module.exports = RetryOperation;
