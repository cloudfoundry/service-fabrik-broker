'use strict';
const _ = require('lodash');
const director = require('../../data-access-layer/bosh').director;
let boshConfigCacheDetails = {};
let deploymentIpsCacheDetails = {};

process.on('unhandledRejection', (err) => console.log('Unhandled rejection - ', err.name));

director.ready.then(() => {
  boshConfigCacheDetails = _.cloneDeep(director.boshConfigCache);
  deploymentIpsCacheDetails = _.cloneDeep(director.deploymentIpsCache);
});
beforeEach(function () {
  director.boshConfigCache = _.cloneDeep(boshConfigCacheDetails);
  director.deploymentIpsCache = _.cloneDeep(deploymentIpsCacheDetails);
});