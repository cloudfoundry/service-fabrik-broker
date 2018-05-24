'use strict';

const nock = require('nock');
const lib = require('../../../broker/lib');
const config = lib.config;
const deploymentHookUrl = `${config.deployment_hooks.protocol}://${config.deployment_hooks.host}`;

exports.executeDeploymentActions = executeDeploymentActions;

function executeDeploymentActions(expectedReturnStatusCode, expectedRequestBody, times) {
  return nock(deploymentHookUrl)
    .post('/hook', body => {
      expect(body).to.deep.equal(expectedRequestBody);
      return true;
    })
    .times(times || 1)
    .reply(expectedReturnStatusCode || 200, {});
}