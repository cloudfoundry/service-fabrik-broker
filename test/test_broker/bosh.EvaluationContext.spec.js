'use strict';

const _ = require('lodash');
const proxyquire = require('proxyquire');
const EvaluationContext = proxyquire('../../broker/lib/bosh/EvaluationContext', {
  crypto: {
    randomBytes: function (n) {
      return _.fill(new Buffer(n), 120);
    }
  },
  uuid: {
    v4: function () {
      return '906de738-4a4b-4b9f-ac12-005a2543327e';
    }
  }
});

describe('bosh', () => {
  describe('EvaluationContext', () => {
    let evaluationContext = new EvaluationContext({
      index: 42,
      properties: {
        bar: [{
          x: 3
        }],
        foo: {
          bar: {
            foo: 'yes'
          }
        }
      }
    });

    describe('#index', () => {
      it('returns the index', () => {
        expect(evaluationContext.index).to.equal(42);
      });
    });
    describe('#require', () => {
      it('returns the require', () => {
        expect(evaluationContext.require('lodash')).to.equal(_);
      });
    });
    describe('#p', () => {
      it('returns the property bar[0].x', () => {
        expect(evaluationContext.p('bar[0].x')).to.equal(3);
      });
      it('returns the property foo.bar.foo', () => {
        expect(evaluationContext.p('foo.bar.foo')).to.equal('yes');
      });
      it('returns the default value for property abc.def', () => {
        expect(evaluationContext.p('abc.def', 42)).to.equal(42);
      });
    });
    describe('#SecureRandom', () => {
      it('returns hex(3)', () => {
        expect(evaluationContext.SecureRandom.hex(3)).to.equal('787878');
      });
      it('returns hex()', () => {
        expect(evaluationContext.SecureRandom.hex()).to.equal('78787878787878787878787878787878');
      });
      it('returns base64(3)', () => {
        expect(evaluationContext.SecureRandom.base64(3)).to.equal('eHh4');
      });
      it('returns random_bytes(3)', () => {
        expect(evaluationContext.SecureRandom.random_bytes(1)).to.eql(new Buffer([120]));
      });
      it('returns a uuid', () => {
        expect(evaluationContext.SecureRandom.uuid()).to.equal('906de738-4a4b-4b9f-ac12-005a2543327e');
      });
    });
  });
});