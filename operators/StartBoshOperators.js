'use strict';

const BoshOperator = require('./bosh-operator/BoshOperator');
const BoshBindOperator = require('./bosh-operator/BoshBindOperator');
const BoshTaskStatusPoller = require('./bosh-operator/BoshTaskStatusPoller');
const BoshStaggeredDeploymentPoller = require('./bosh-operator/BoshStaggeredDeploymentPoller');
const BoshPostProcessingPoller = require('./bosh-operator/BoshPostProcessingPoller');

const boshOperator = new BoshOperator();
const boshBindOperator = new BoshBindOperator();
/* jshint nonew:false */
new BoshTaskStatusPoller();
new BoshStaggeredDeploymentPoller();
new BoshPostProcessingPoller(); // TODO maybe disable this with the feature switch
boshOperator.init();
boshBindOperator.init();
