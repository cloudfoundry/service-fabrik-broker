'use strict';

const BOSHManager = require('./bosh-manager/BOSHManager');
const BOSHBindManager = require('./bosh-manager/BOSHBindManager');
const BOSHTaskPoller = require('./bosh-manager/BOSHTaskPoller');

BOSHTaskPoller.start();
const boshManager = new BOSHManager();
const bindManager = new BOSHBindManager();
boshManager.init();
bindManager.init();