'use strict';

const BoshManager = require('./bosh-manager/BoshManager');
const BoshBindOperator = require('./bosh-manager/BoshBindOperator');
const BoshTaskStatusPoller = require('./bosh-manager/BoshTaskStatusPoller');

const boshManager = new BoshManager();
const bindOperator = new BoshBindOperator();
/* jshint nonew:false */
new BoshTaskStatusPoller();
boshManager.init();
bindOperator.init();