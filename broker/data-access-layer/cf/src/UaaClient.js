'use strict';

const _ = require('lodash');
const querystring = require('querystring');
const { HttpClient } = require('@sf/common-utils');
const config = require('@sf/app-config');

class UaaClient extends HttpClient {
  constructor(options, baseUrl = '') {
    if (!baseUrl) {
      baseUrl = config.cf.token_endpoint;
    }
    super(_.defaultsDeep({
      headers: {
        Accept: 'application/json'
      },
      maxRedirects: 0
    }, options, {
      baseURL: baseUrl,
      rejectUnauthorized: !config.skip_ssl_validation
    }));
    this.clientId = config.cf.client_id || 'cf';
  }

  authorizationUrl(options, loginHint) {
    options = _.assign({
      response_type: 'code'
    }, options);
    if (loginHint && loginHint !== '') {
      options.login_hint = `{"origin":"${loginHint}"}`;
    }
    if (Array.isArray(options.scope)) {
      options.scope = options.scope.join(' ');
    }
    return `${config.cf.authorization_endpoint}/oauth/authorize?${querystring.stringify(options)}`;
  }

  userInfo(accessToken) {
    return this.request({
      method: 'GET',
      url: '/userinfo',
      auth: false,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      params: {
        schema: 'openid'
      },
      responseType: 'json'
    }, 200).then(res => {
      return res.body;
    });
  }


  tokenKey() {
    return this
      .request({
        method: 'GET',
        url: '/token_key',
        responseType: 'json'
      }, 200)
      .then(res => res.body);
  }

  checkToken(client, token, scopes) {
    return this
      .request({
        method: 'POST',
        url: '/check_token',
        auth: {
          username: client.id,
          password: client.secret
        },
        data: querystring.stringify({
          token: token,
          scopes: _.join(scopes, ',')
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        }
      }, 200)
      .then(res => res.body);
  }

  accessWithAuthorizationCode(client, code) {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      auth: {
        username: client.id,
        password: client.secret
      },
      data: querystring.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: client.redirect_uri
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    }, 200).then(res => {
      return res.body;
    });
  }

  getScope(username, password) {
    return this
      .accessWithPassword(username, password)
      .then(resp => _
        .chain(resp)
        .get('scope')
        .split(' ')
        .value()
      );
  }

  accessWithPassword(username, password) {
    let formData = {
      grant_type: 'password',
      client_id: this.clientId,
      username: username,
      password: password
    };
    if (config.cf.identity_provider) {
      formData.login_hint = `{"origin":"${config.cf.identity_provider}"}`;
    }
    const reqBody = {
      method: 'POST',
      url: '/oauth/token',
      auth: {
        username: this.clientId,
        password: ''
      },
      data: querystring.stringify(formData),
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    };
    return this.request(reqBody, 200).then(res => {
      return res.body;
    });
  }

  accessWithRefreshToken(refreshToken) {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      auth: {
        username: this.clientId,
        password: ''
      },
      data: querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    }, 200).then(res => {
      return res.body;
    });
  }

  accessWithClientCredentials(clientId, clientSecret) {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      auth: {
        username: clientId,
        password: clientSecret
      },
      data: querystring.stringify({
        grant_type: 'client_credentials',
        response_type: 'token'
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    }, 200).then(res => {
      return res.body;
    });
  }
}

module.exports = UaaClient;
