'use strict';

const _ = require('lodash');
const querystring = require('querystring');
const HttpClient = require('../../broker/lib/utils').HttpClient;
const config = require('../../common/config');

class UaaClient extends HttpClient {
  constructor(options) {
    super(_.defaultsDeep({
      headers: {
        Accept: 'application/json'
      },
      followRedirect: false
    }, options, {
      baseUrl: config.cf.token_endpoint,
      rejectUnauthorized: !config.skip_ssl_validation
    }));
    this.clientId = config.cf.client_id || 'cf';
  }

  authorizationUrl(options) {
    options = _.assign({
      response_type: 'code'
    }, options);
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
    }, 200).then((res) => {
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
    }, 200).then((res) => {
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
    return this.request({
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
    }, 200).then((res) => {
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
    }, 200).then((res) => {
      return JSON.parse(res.body);
    });
  }
}

module.exports = UaaClient;