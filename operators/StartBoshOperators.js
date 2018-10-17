'use strict';

const BoshOperator = require('./bosh-operator/BoshOperator');
const BoshBindOperator = require('./bosh-operator/BoshBindOperator');
const BoshTaskStatusPoller = require('./bosh-operator/BoshTaskStatusPoller');

const boshOperator = new BoshOperator();
const boshBindOperator = new BoshBindOperator();
/* jshint nonew:false */
new BoshTaskStatusPoller();
boshOperator.init();
boshBindOperator.init();