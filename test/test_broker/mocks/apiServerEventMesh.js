'use strict';

const nock = require('nock');
const apiServerHost = 'https://127.0.0.1:9443';
const swagger = require('../helper-files/apiserver-swagger.json');


exports.nockLoadSpec = nockLoadSpec;
exports.nockCreateResource = nockCreateResource;
exports.nockPatchResource = nockPatchResource;
exports.nockGetResource = nockGetResource;
exports.nockGetResourceRegex = nockGetResourceRegex;
exports.nockDeleteResource = nockDeleteResource;
exports.nockPatchResourceRegex = nockPatchResourceRegex;
exports.nockCreateCrd = nockCreateCrd;
exports.nockPatchCrd = nockPatchCrd;

function nockLoadSpec(times) {
  nock(apiServerHost)
    .get('/swagger.json')
    .times(times || 1)
    .reply(200, swagger);
}

function nockCreateCrd(resourceGroup, resourceType, response, times) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}/v1beta1/customresourcedefinitions`)
    .times(times || 1)
    .reply(201, response);
}

function nockPatchCrd(resourceGroup, resourceType, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}/v1beta1/customresourcedefinitions/${resourceType}`)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}


function nockCreateResource(resourceGroup, resourceType, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s`)
    .times(times || 1)
    .reply(expectedStatusCode || 201, response);
}

function nockPatchResource(resourceGroup, resourceType, id, response, times) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .times(times || 1)
    .reply(200, response);
}

function nockGetResourceRegex(resourceGroup, resourceType, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(new RegExp(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})`))
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockPatchResourceRegex(resourceGroup, resourceType, response, times, verifier, expectedStatusCode) {
  nock(apiServerHost)
    .patch(
      new RegExp(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})`),
      verifier)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockDeleteResource(resourceGroup, resourceType, id, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .delete(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}

function nockGetResource(resourceGroup, resourceType, id, response, times, expectedStatusCode) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .times(times || 1)
    .reply(expectedStatusCode || 200, response);
}