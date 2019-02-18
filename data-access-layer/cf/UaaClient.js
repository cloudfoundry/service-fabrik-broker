'use strict';

const _ = require('lodash');
const querystring = require('querystring');
const HttpClient = require('../../common/utils').HttpClient;
const config = require('../../common/config');

class UaaClient extends HttpClient {
  constructor(options, baseUrl = '') {
    if (!baseUrl) {
      baseUrl = config.cf.token_endpoint;
    }
    super(_.defaultsDeep({
      headers: {
        Accept: 'application/json'
      },
      followRedirect: false
    }, options, {
      baseUrl: baseUrl,
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
      auth: {
        bearer: accessToken
      },
      qs: {
        schema: 'openid'
      },
      json: true
    }, 200).then(res => {
      return res.body;
    });
  }


  tokenKey() {
    return this
      .request({
        method: 'GET',
        url: '/token_key',
        json: true
      }, 200)
      .then(res => res.body);
  }

  checkToken(client, token, scopes) {
    return this
      .request({
        method: 'POST',
        url: '/check_token',
        auth: {
          user: client.id,
          pass: client.secret
        },
        form: {
          token: token,
          scopes: _.join(scopes, ',')
        }
      }, 200)
      .then(res => JSON.parse(res.body));
  }

  accessWithAuthorizationCode(client, code) {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      auth: {
        user: client.id,
        pass: client.secret
      },
      form: {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: client.redirect_uri
      }
    }, 200).then(res => {
      return JSON.parse(res.body);
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
    const reqBody = {
      method: 'POST',
      url: '/oauth/token',
      auth: {
        user: this.clientId,
        pass: ''
      },
      form: {
        grant_type: 'password',
        client_id: this.clientId,
        username: username,
        password: password
      }
    };
    if (config.cf.identity_provider) {
      reqBody.form.login_hint = `{"origin":"${config.cf.identity_provider}"}`;
    }
    return this.request(reqBody, 200).then(res => {
      return JSON.parse(res.body);
    });
  }

  accessWithRefreshToken(refreshToken) {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      auth: {
        user: this.clientId,
        pass: ''
      },
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }
    }, 200).then(res => {
      return JSON.parse(res.body);
    });
  }

  accessWithClientCredentials(clientId, clientSecret) {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      auth: {
        user: clientId,
        pass: clientSecret
      },
      form: {
        grant_type: 'client_credentials',
        response_type: 'token'
      }
    }, 200).then(res => {
      return JSON.parse(res.body);
    });
  }
}

module.exports = UaaClient;
