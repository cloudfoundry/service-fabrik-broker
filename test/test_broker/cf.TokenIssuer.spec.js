'use strict';

const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const TokenIssuer = proxyquire('../../data-access-layer/cf/TokenIssuer', {});

const expiredToken = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9';

let tokenNotExpired = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjM4MzQ4NjQwMDB9';
let tokenInfoNotExpired = {
  access_token: tokenNotExpired,
  refresh_token: tokenNotExpired,
  token_type: 'bearer'
};
let tokenInfoExpired = {
  access_token: expiredToken,
  refresh_token: expiredToken,
  token_type: 'bearer'
};

describe('cf', () => {
  describe('TokenIssuer', () => {
    let uaa = {
      accessWithPassword: function () {
        return Promise.resolve(tokenInfoExpired);
      },
      accessWithRefreshToken: function (token) {
        if (token === tokenNotExpired) {
          return Promise.resolve(tokenInfoNotExpired);
        } else {
          return Promise.reject(tokenInfoExpired);
        }
      },
      accessWithClientCredentials: function (client_id, client_secret){
        return Promise.try(() => {
          return tokenInfoNotExpired;
        });
      }
    };
    let tokenIssuer = new TokenIssuer(uaa);

    describe('logout', () => {
      it('updates the tokenInfo property', () => {
        tokenIssuer.logout();
        expect(tokenIssuer.tokenInfo.accessToken).to.eql(expiredToken);
      });

      it('updates the tokenInfo property (has a set timeoutObject property)', () => {
        tokenIssuer.timeoutObject = setTimeout(() => {}, 0);
        tokenIssuer.logout();
        expect(tokenIssuer.tokenInfo.accessToken).to.eql(expiredToken);
      });
    });

    describe('login', () => {
      it('returns an empty object', (done) => {
        tokenIssuer.login().then((content) => {
          expect(content).to.eql(tokenInfoExpired);
          done();
        }).catch(done);
      });
    });

    describe('refreshToken', () => {
      it('returns a promise resolving a token-info', (done) => {
        tokenIssuer.tokenInfo.refreshToken = tokenNotExpired;
        tokenIssuer.refreshToken().then((content) => {
          expect(content).to.eql(tokenInfoNotExpired);
          done();
        }).catch(done);
      });

      it('returns a promise rejecting a token-info', (done) => {
        tokenIssuer.tokenInfo.refreshToken = expiredToken;
        tokenIssuer.refreshToken().then(done).catch((content) => {
          expect(content).to.eql(tokenInfoExpired);
          done();
        });
      });
    });

    describe('updateTokenInfo', () => {
      it('returns the updated tokenInfo property (with a token expiring in past)', () => {
        tokenIssuer.updateTokenInfo(tokenInfoExpired);
        expect(tokenIssuer.tokenInfo).to.eql({
          accessToken: expiredToken,
          refreshToken: expiredToken,
          tokenType: 'bearer'
        });
      });

      it('returns the updated tokenInfo property (with a token expiring in future)', () => {
        tokenIssuer.updateTokenInfo(tokenInfoNotExpired);
        expect(tokenIssuer.tokenInfo).to.eql({
          accessToken: tokenNotExpired,
          refreshToken: tokenNotExpired,
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

      it('returns a promise (accessToken expire soon, but refreshToken does not)', (done) => {
        tokenInfoNotExpired.access_token = expiredToken;
        tokenIssuer.updateTokenInfo(tokenInfoNotExpired);
        tokenIssuer.getAccessToken().then((content) => {
          expect(content).to.eql(expiredToken);
          done();
        }).catch(done);
      });

      it('returns a promise (both tokens expire soon)', (done) => {
        tokenIssuer.updateTokenInfo(tokenInfoExpired);
        tokenIssuer.getAccessToken().then((content) => {
          expect(content).to.eql(expiredToken);
          done();
        }).catch(done);
      });
    });
    describe('getAccessTokenBoshUAA', () => {
      it('should return existing access token (accessToken does not expire soon)', (done) => {
        tokenIssuer.updateTokenInfo(tokenInfoNotExpired);
        tokenIssuer.getAccessTokenBoshUAA().then((content) => {
          expect(content).to.eql(tokenNotExpired);
          done();
        }).catch(done);
      });

      it('should make explicit request for access token (access token expires soon)', (done) => {
        tokenIssuer.updateTokenInfo(tokenInfoExpired);
        let sandbox = sinon.sandbox.create();
        let scheduleAccessTokenStub = sandbox.stub(tokenIssuer, 'scheduleNextRequestAccessToken');
        tokenIssuer.getAccessTokenBoshUAA().then((content) => {
          expect(content).to.eql(tokenNotExpired);
          expect(scheduleAccessTokenStub).to.be.calledOnce;
          sandbox.restore();
          done();
        }).catch(done);
      });
    });

    describe('scheduleNextRequestAccessToken', () => {
      it('should create a valid timeout object', () => {
        //IST: Sunday, August 25, 2086 3:36:08 AM. Delay < 2147483647, as per condition in this function.
        let tokenExpiresSpecificDate = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjM2ODEwNjUxNjh9';
        let tokenInfoSpecific = {
          access_token: tokenExpiresSpecificDate,
          refresh_token: tokenExpiresSpecificDate,
          token_type: 'bearer'
        };
        tokenIssuer.updateTokenInfo(tokenInfoSpecific);
        let sandbox = sinon.sandbox.create();
        let setTimeoutStub = sandbox.stub(global, 'setTimeout')
        tokenIssuer.scheduleNextRequestAccessToken();
        expect(setTimeoutStub).to.be.calledOnce;
        sandbox.restore();
      });
    });
  });
});