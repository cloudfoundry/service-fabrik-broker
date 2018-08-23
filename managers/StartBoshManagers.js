'use strict';

const BoshManager = require('./bosh-manager/BoshManager');
const BoshBindManager = require('./bosh-manager/BoshBindManager');
const BoshTaskPoller = require('./bosh-manager/BoshTaskPoller');

BoshTaskPoller.start();
const boshManager = new BoshManager();
const bindManager = new BoshBindManager();
boshManager.init();
bindManager.init();