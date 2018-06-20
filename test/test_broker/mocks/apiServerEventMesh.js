'use strict';

const _ = require('lodash');
const nock = require('nock');
const apiServerHost = 'https://10.0.2.2:9443';
const swagger = require('../apiserver-swagger.json');


exports.nockLoadSpec = nockLoadSpec;
exports.nockCreateResource = nockCreateResource;
exports.nockPatchResourceStatus = nockPatchResourceStatus;
exports.nockPatchResource = nockPatchResource;
exports.nockGetResource = nockGetResource;
exports.nockGetResourceRegex = nockGetResourceRegex;

function nockLoadSpec(times) {
  nock(apiServerHost)
    .get('/swagger.json')
    .times(times || 1)
    .reply(200, swagger);
}

function nockCreateResource(resourceGroup, resourceType, response, times) {
  nock(apiServerHost)
    .post(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s`)
    .times(times || 1)
    .reply(201, response);
}

function nockPatchResourceStatus(resourceGroup, resourceType, response, times) {
  nock(apiServerHost)
    //.patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s$`)
    .patch(/status$/)
    .times(times || 1)
    .reply(200, response);
}

function nockPatchResource(resourceGroup, resourceType, id, response, times) {
  nock(apiServerHost)
    .patch(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .times(times || 1)
    .reply(200, response);
}

function nockGetResourceRegex(resourceGroup, resourceType, response, times) {
  nock(apiServerHost)
    .get(new RegExp(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})`))
    .times(times || 1)
    .reply(200, response);
}

function nockGetResource(resourceGroup, resourceType, id, response, times) {
  nock(apiServerHost)
    .get(`/apis/${resourceGroup}.servicefabrik.io/v1alpha1/namespaces/default/${resourceType}s/${id}`)
    .times(times || 1)
    .reply(200, response);
}