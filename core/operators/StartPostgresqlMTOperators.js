'use strict';

const MultitenancyOperator = require('./multitenancy-operator/MultitenancyOperator');
const MultitenancylBindOperator = require('./multitenancy-operator/MultitenancyBindOperator');
const CONST = require('../common/constants');

const postgresqlMTOperator = new MultitenancyOperator(CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, CONST.MULTITENANCY_SERVICE_TYPE.MULTITENANCYSERVICE);
const postgresqlMTBindOperator = new MultitenancylBindOperator(CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT_BIND, CONST.APISERVER.RESOURCE_TYPES.POSTGRESQL_MT, CONST.MULTITENANCY_SERVICE_TYPE.MULTITENANCYBINDSERVICE);
postgresqlMTOperator.init();
postgresqlMTBindOperator.init();
