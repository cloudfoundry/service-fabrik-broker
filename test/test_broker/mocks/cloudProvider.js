'use strict';

const _ = require('lodash');
const nock = require('nock');
const config = require('../../../common/config');
const provider = config.backup.provider;
const cloudProviderUrl = provider.authUrl;
const objectStoreUrl = `http://objectstore/v1/AUTH_${provider.tenantId}`;

exports.auth = auth;
exports.download = download;
exports.upload = upload;
exports.headObject = headObject;
exports.getContainer = getContainer;
exports.list = list;
exports.remove = remove;

function auth(times) {
  const time = Date.now();
  const response = {
    body: {
      token: {
        expires_at: new Date(time + 365 * 24 * 60 * 60 * 1000),
        issued_at: new Date(time),
        project: {
          id: provider.tenantId
        },
        catalog: [{
          type: 'object-store',
          endpoints: [{
            region: provider.region,
            url: objectStoreUrl,
            interface: 'public'
          }]
        }]
      }
    },
    headers: {
      'x-subject-token': '5702f655079c43f5a36687976db0a403'
    }
  };
  return nock(cloudProviderUrl)
    .replyContentLength()
    .post(`/${provider.keystoneAuthVersion}/auth/tokens`, body => _.isObject(body.auth))
    .times(times || 1)
    .reply(201, response.body, response.headers);
}

function encodePath(pathname) {
  return pathname.replace(/:/g, '%3A');
}

function download(remote, body, times) {
  const headers = {
    'content-type': 'application/json'
  };
  let status = 200;
  if (body instanceof Error && body.status) {
    const err = _.pick(body, 'status', 'message');
    status = err.status;
    headers['content-type'] = 'text/html';
    body = `<h1>${err.message}</h1>`;
  } else if (_.isPlainObject(body)) {
    body = JSON.stringify(body);
  }
  return nock(objectStoreUrl)
    .replyContentLength()
    .get(encodePath(remote))
    .times(times || 1)
    .reply(status, body, headers);
}

function upload(remote, verifier) {
  return nock(objectStoreUrl)
    .replyContentLength()
    .put(encodePath(remote), verifier)
    .reply(201);
}

function headObject(remote) {
  return nock(objectStoreUrl)
    .replyContentLength()
    .head(encodePath(remote))
    .query({
      format: 'json'
    })
    .reply(200);
}

function remove(remote) {
  return nock(objectStoreUrl)
    .delete(encodePath(remote))
    .reply(204);
}

function getContainer(containerName) {
  return nock(objectStoreUrl)
    .replyContentLength()
    .head(`/${containerName}`)
    .reply(204, null, {
      'X-Container-Object-Count': 0
    });
}

function list(containerName, prefix, filenames, responseStatusCode, times, lastModifiedDate) {
  const lastModifiedDateISO = lastModifiedDate ? new Date(lastModifiedDate).toISOString() : new Date().toISOString();
  const files = _
    .chain(filenames)
    .map(name => ({
      name: name,
      last_modified: lastModifiedDateISO
    }))
    .value();
  const qs = {
    format: 'json'
  };
  if (prefix) {
    qs.prefix = prefix;
  }
  return nock(objectStoreUrl)
    .replyContentLength()
    .get(`/${containerName}`)
    .query(qs)
    .times(times || 1)
    .reply(responseStatusCode || 200, files, {
      'X-Container-Object-Count': '42'
    });
}