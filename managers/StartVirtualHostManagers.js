'use strict';

const VirtualHostOperator = require('./virtualhost-operator/VirtualHostOperator');
const VirtualHostBindOperator = require('./virtualhost-operator/VirtualHostBindOperator');

const virtualHostOperator = new VirtualHostOperator();
const virtualHostBindOperator = new VirtualHostBindOperator();
virtualHostOperator.init();
virtualHostBindOperator.init();