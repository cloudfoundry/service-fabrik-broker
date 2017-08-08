'use strict';

const expiredToken = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.msVIuUXhvFBvkf9A6JOkQndeuRZiGKuj0ojGdvR2dPI';

class TokenInfo {

  constructor() {
    this.accessToken = expiredToken;
    this.refreshToken = expiredToken;
    this.tokenType = 'bearer';
  }

  get authHeader() {
    return `${this.tokenType} ${this.accessToken}`;
  }

  get accessTokenExpiresIn() {
    return this.expiresIn(this.accessToken);
  }

  get refreshTokenExpiresIn() {
    return this.expiresIn(this.refreshToken);
  }

  get accessTokenExpiresSoon() {
    return this.expiresSoon(this.accessToken);
  }

  get refreshTokenExpiresSoon() {
    return this.expiresSoon(this.refreshToken);
  }

  update(tokenInfo) {
    this.accessToken = tokenInfo.access_token;
    this.refreshToken = tokenInfo.refresh_token;
    this.tokenType = tokenInfo.token_type;
    return this;
  }

  expiresIn(token) {
    return this.parseToken(token)[1].exp - Math.floor(Date.now() / 1000);
  }

  expiresSoon(token) {
    return this.expiresIn(token) < 15;
  }

  parseToken(token) {
    return token.split('.').slice(0, 2).map((part) => {
      return JSON.parse(new Buffer(part, 'base64').toString('utf8'));
    });
  }
}

module.exports = TokenInfo;