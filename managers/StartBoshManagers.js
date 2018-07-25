'use strict';

const BOSHManager = require('./bosh-manager/BOSHManager');
const BOSHBindManager = require('./bosh-manager/BOSHBindManager');
const BOSHTaskpoller = require('./bosh-manager/BOSHTaskpoller');

BOSHTaskpoller.start();
const boshManager = new BOSHManager();
const bindManager = new BOSHBindManager();
boshManager.init();
bindManager.init();