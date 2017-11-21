'use strict';
const _ = require('lodash');
const lib = require('../lib');

const director = lib.bosh.director;
let cacheDetails = {};
director.ready.then(() => {
  cacheDetails = _.cloneDeep(director.cache);
});
beforeEach(function () {
  director.cache = _.cloneDeep(cacheDetails);
});