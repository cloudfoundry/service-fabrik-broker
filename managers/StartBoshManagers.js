'use strict';

const BoshManager = require('./bosh-manager/BoshManager');
const BoshBindManager = require('./bosh-manager/BoshBindManager');
const BoshTaskStatusPoller = require('./bosh-manager/BoshTaskStatusPoller');

const boshManager = new BoshManager();
const bindManager = new BoshBindManager();
/* jshint nonew:false */
new BoshTaskStatusPoller();
boshManager.init();
bindManager.init();