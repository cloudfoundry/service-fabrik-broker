'use strict';
const _ = require('lodash');
const lib = require('../../broker/lib');

const director = lib.bosh.director;
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