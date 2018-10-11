'use strict';

const BoshOperator = require('./bosh-manager/BoshOperator');
const BoshBindOperator = require('./bosh-manager/BoshBindOperator');
const BoshTaskStatusPoller = require('./bosh-manager/BoshTaskStatusPoller');

const boshOperator = new BoshOperator();
const boshBindOperator = new BoshBindOperator();
/* jshint nonew:false */
new BoshTaskStatusPoller();
boshOperator.init();
boshBindOperator.init();