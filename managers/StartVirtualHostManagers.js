'use strict';

const VirtualHostManager = require('./virtualhost-manager/VirtualHostManager');
const VirtualHostBindManager = require('./virtualhost-manager/VirtualHostBindManager');

const virtualHostManager = new VirtualHostManager();
const virtualHostBindManager = new VirtualHostBindManager();
virtualHostManager.init();
virtualHostBindManager.init();