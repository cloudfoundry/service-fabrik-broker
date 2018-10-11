'use strict';

const BoshOperator = require('./bosh-operator/BoshOperator');
const BoshBindOperator = require('./bosh-operator/BoshBindOperator');
const BoshTaskStatusPoller = require('./bosh-operator/BoshTaskStatusPoller');
const BoshStaggeredDeploymentPoller = require('./bosh-manager/BoshStaggeredDeploymentPoller');

const boshOperator = new BoshOperator();
const boshBindOperator = new BoshBindOperator();
/* jshint nonew:false */
new BoshTaskStatusPoller();
new BoshStaggeredDeploymentPoller();
boshOperator.init();
boshBindOperator.init();