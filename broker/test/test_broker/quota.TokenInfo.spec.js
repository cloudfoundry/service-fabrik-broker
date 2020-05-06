'use strict';

const TokenInfo = require('../../data-access-layer/quota/src/TokenInfo');

const tokenType = 'bearer';
const expiredToken = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9';

describe('quota', () => {
  describe('TokenInfo', () => {
    let tokenInfo = new TokenInfo();

    describe('authHeader', () => {
      it('returns a composed string', () => {
        expect(tokenInfo.authHeader).eql(`${tokenType} ${expiredToken}`);
      });
    });

    describe('accessTokenExpiresIn', () => {
      it('returns true', () => {
        expect(tokenInfo.accessTokenExpiresIn).to.be.below(0);
      });
    });

    describe('accessTokenExpiresSoon', () => {
      it('returns true', () => {
        expect(tokenInfo.accessTokenExpiresSoon).to.be.eql(true);
      });
    });

    describe('expiresIn', () => {
      it('returns a negative number', () => {
        expect(tokenInfo.expiresIn(expiredToken)).to.be.below(0);
      });
    });

    describe('expiresSoon', () => {
      it('returns true', () => {
        expect(tokenInfo.expiresSoon(expiredToken)).to.be.eql(true);
      });
    });

    describe('parseToken', () => {
      it('returns the decoded parts of a token', () => {
        let expectedObject = [{
          alg: 'HS256'
        }, {
          exp: 0
        }];
        expect(tokenInfo.parseToken(expiredToken)).to.eql(expectedObject);
      });
    });

    describe('update', () => {
      it('returns new access_token', () => {
        tokenInfo.update({
          access_token: 'new_access_token',
          token_type: 'bearer'
        });

        expect(tokenInfo.accessToken).to.eql('new_access_token');
      });
    });
  });
});
