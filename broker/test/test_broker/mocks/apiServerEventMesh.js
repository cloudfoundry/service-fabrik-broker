'use strict';

const _ = require('lodash');
const nock = require('nock');
const config = require('@sf/app-config');
const {
  CONST
} = require('@sf/common-utils');
const apiServerHost = `https://${config.apiserver.ip}:${config.apiserver.port}`;


exports.nockCreateResource = nockCreateResource;
exports.nockPatchResource = nockPatchResource;
exports.nockGetResource = nockGetResource;
exports.nockGetConfigMap = nockGetConfigMap;
exports.nockGetResourceRegex = nockGetResourceRegex;
exports.nockDeleteResource = nockDeleteResource;
exports.nockPatchResourceRegex = nockPatchResourceRegex;
exports.nockGetResourceListByState = nockGetResourceListByState;
exports.nockCreateCrd = nockCreateCrd;
exports.nockGetCrd = nockGetCrd;
exports.nockPatchCrd = nockPatchCrd;
exports.nockGetResources = nockGetResources;
exports.nockCreateNamespace = nockCreateNamespace;
exports.nockGetSecret = nockGetSecret;
exports.nockDeleteNamespace = nockDeleteNamespace;
exports.nockGetResourcesAcrossAllNamespaces = nockGetResourcesAcrossAllNamespaces;
exports.nockRegisterWatcher = nockRegisterWatcher;

const expectedGetConfigMapResponseEnabled = {
  apiVersion: 'v1',
  data: {
    disable_scheduled_update_blueprint: 'false'
  },
  kind: 'ConfigMap',
  metadata: {
    creationTimestamp: '2018-12-05T11:31:28Z',
    name: 'sfconfig',
    namespace: 'default',
    resourceVersion: '370255',
    selfLink: '/api/v1/namespaces/default/configmaps/sfconfig',
    uid: '4e47d831-f881-11e8-9055-123c04a61866'
  }
};

const expectedGetConfigMapResponseDisabled = {
  apiVersion: 'v1',
  data: {
    disable_scheduled_update_blueprint: 'false'
  },
  kind: 'ConfigMap',
  metadata: {
    creationTimestamp: '2018-12-05T11:31:28Z',
    name: 'sfconfig',
    namespace: 'default',
    resourceVersion: '370255',
    selfLink: '/api/v1/namespaces/default/configmaps/sfconfig',
    uid: '4e47d831-f881-11e8-9055-123c04a61866'
  }
};

function nockRegisterWatcher(resourceGroup, resourceType, query, times, response) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1alpha1/watch/${resourceType}`)
    .query(query)
    .times(times || 1)
    .reply(200, response);
}

function nockCreateCrd(resourceGroup, resourceType, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}/v1/customresourcedefinitions`)
    .times(times || 1)
    .reply(expectedStatusCode || 201, response || {});
}

function nockCreateNamespace(name, response, times, verifier, expectedStatusCode) {
  nock(apiServerHost)
    .post(`/api/v1/namespaces`, verifier)
    .times(times || 1)
    .reply(expectedStatusCode || 201, response);
}

function nockDeleteNamespace(name, response, times, verifier, expectedStatusCode) {
  nock(apiServerHost)
    .delete(`/api/v1/namespaces/${name}`, verifier)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockPatchCrd(resourceGroup, resourceType, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}/v1/customresourcedefinitions/${resourceType}`)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetCrd(resourceGroup, resourceType, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1/customresourcedefinitions/${resourceType}`)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockCreateResource(resourceGroup, resourceType, response, times, verifier, expectedStatusCode) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}`, _.matches(verifier))
    .times(times || 1)
    .reply(expectedStatusCode || 201, response);
}

function nockGetConfigMap(expectedStatusCode, enabled) {
  nock(apiServerHost)
    .get(`/api/${CONST.APISERVER.CONFIG_MAP.API_VERSION}/namespaces/${_.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE)}/configmaps`)
    .reply(expectedStatusCode || 200, enabled ? expectedGetConfigMapResponseEnabled : expectedGetConfigMapResponseDisabled);
}

function nockPatchResource(resourceGroup, resourceType, id, response, times, payload, expectedStatusCode) {
  nock(apiServerHost, {
      reqheaders: {
        'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
      }
    })
    .patch(
      `/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/${id}`, _.matches(payload)
    )
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetResourceRegex(resourceGroup, resourceType, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(new RegExp(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})`))
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockPatchResourceRegex(resourceGroup, resourceType, response, times, verifier, expectedStatusCode) {
  nock(apiServerHost)
    .patch(
      new RegExp(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})`),
      verifier)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockDeleteResource(resourceGroup, resourceType, id, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .delete(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/${id}`)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetResource(resourceGroup, resourceType, id, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}/${id}`)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetSecret(secretName, namespaceId, response, times, expectedStatusCode, payload) {
  let ordered;
  if (!_.isUndefined(payload)) {
    ordered = {};
    Object.keys(payload).sort().forEach(function (key) {
      ordered[key] = payload[key];
    });
  }
  nock(apiServerHost)
    .get(`/api/v1/namespaces/${namespaceId}/secrets/${secretName}`, ordered)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetResources(resourceGroup, resourceType, response, query, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}`)
    .query(query)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetResourcesAcrossAllNamespaces(resourceGroup, resourceType, response, query, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1alpha1/${resourceType}`)
    .query(query)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetResourceListByState(resourceGroup, resourceType, stateList, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}/v1alpha1/namespaces/default/${resourceType}`)
    .query({
      labelSelector: `state in (${_.join(stateList, ',')})`
    })
    .times(times || 1)
    .reply(expectedStatusCode || 200, {
      items: response
    });
}