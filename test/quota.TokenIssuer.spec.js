'use strict';

const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const TokenIssuer = proxyquire('../broker/lib/quota/TokenIssuer', {});

let tokenExpired = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.msVIuUXhvFBvkf9A6JOkQndeuRZiGKuj0ojGdvR2dPI';
let tokenNotExpired = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjM4MzQ4NjQwMDB9.msVIuUXhvFBvkf9A6JOkQndeuRZiGKuj0ojGdvR2dPI';

let tokenInfoNotExpired = {
  access_token: tokenNotExpired,
  token_type: 'bearer'
};
let tokenInfoExpired = {
  access_token: tokenExpired,
  token_type: 'bearer'
};

describe('quota', () => {
  describe('TokenIssuer', () => {
    let quotaAPIAuthClient = {
      accessWithClientCredentials: function () {
        return Promise.resolve(tokenInfoNotExpired);
      }
    };
    let tokenIssuer = new TokenIssuer(quotaAPIAuthClient);

    describe('refreshToken', () => {
      it('returns a promise resolving a token-info', (done) => {
        tokenIssuer.refreshToken().then((content) => {
          expect(content).to.eql(tokenInfoNotExpired);
          done();
        }).catch(done);
      });
    });

    describe('updateTokenInfo', () => {
      it('returns the updated tokenInfo property (with a token expiring in past)', () => {
        tokenIssuer.updateTokenInfo(tokenInfoExpired);
        expect(tokenIssuer.tokenInfo).to.eql({
          accessToken: tokenExpired,
          tokenType: 'bearer'
        });
      });

      it('returns the updated tokenInfo property (with a token expiring in future)', () => {
        tokenIssuer.updateTokenInfo(tokenInfoNotExpired);
        expect(tokenIssuer.tokenInfo).to.eql({
          accessToken: tokenNotExpired,
          tokenType: 'bearer'
        });
      });
    });

    describe('getAccessToken', () => {
      it('returns a promise (accessToken does not expire soon)', (done) => {
        tokenIssuer.updateTokenInfo(tokenInfoNotExpired);
        tokenIssuer.getAccessToken().then((content) => {
          expect(content).to.eql(tokenNotExpired);
          done();
        }).catch(done);
      });

      it('returns a promise (accessToken expire soon, so accessToken is refreshed and also updated in tokenInfo)', (done) => {
        tokenIssuer.updateTokenInfo(tokenInfoExpired);
        tokenIssuer.getAccessToken().then((content) => {
          expect(content).to.eql(tokenNotExpired);
          expect(tokenIssuer.tokenInfo.accessToken).to.eql(tokenNotExpired);
          done();
        }).catch(done);
      });
    });
  });
});