'use strict';

const lib = require('../../broker/lib');
const RetryOperation = lib.utils.RetryOperation;
const Timeout = require('../../common/errors').Timeout;

describe('utils', function () {
  describe('RetryOperation', function () {
    let maxAttempts = 3;
    let timeout = 50;
    let factor = 2;
    let minDelay = 5;
    let maxDelay = 100;
    let retryOperation;

    beforeEach(function () {
      retryOperation = RetryOperation.create({
        maxAttempts: maxAttempts,
        timeout: timeout,
        factor: factor,
        minDelay: minDelay,
        maxDelay: maxDelay
      });
    });

    describe('#constructor', function () {
      it('should create a retry operation', function () {
        expect(retryOperation.maxAttempts).to.equal(maxAttempts);
        expect(retryOperation.timeout).to.equal(timeout);
      });
    });

    describe('#predicate', function () {
      it('should return true', function () {
        expect(retryOperation.predicate()).to.equal(true);
      });
    });

    describe('#backoff', function () {
      it('should return the backoff for the zero try', function () {
        const backoff = retryOperation.backoff(0);
        expect(backoff).to.equal(0);
      });
      it('should return the backoff for the first try', function () {
        const backoff = retryOperation.backoff(1);
        expect(backoff).to.equal(minDelay);
      });
      it('should return the backoff for the second try', function () {
        const backoff = retryOperation.backoff(2);
        expect(backoff).to.equal(factor * minDelay);
      });
    });
    describe('#retry', function () {
      it('should fail with to many attempts', function () {
        return retryOperation
          .retry(() => {
            throw Error('error');
          })
          .throw(new Error('ExpectedTimeout'))
          .catch(Timeout, err => {
            expect(err.message).to.match(/^Operation failed after \d+ attempts/);
          });
      });
      describe('with more attempts', function () {
        before(function () {
          maxAttempts = 10;
        });

        it('should fail with a timeout', function () {
          return retryOperation
            .retry(() => {
              throw Error('error');
            })
            .throw(new Error('ExpectedTimeout'))
            .catch(Timeout, err => {
              expect(err.message).to.match(/^Operation timed out after \d+ ms/);
            });
        });
      });
    });
  });
});