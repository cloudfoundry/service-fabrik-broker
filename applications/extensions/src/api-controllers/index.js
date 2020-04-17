'use strict';
const _ = require('lodash');
const config = require('@sf/app-config');

if (!_.includes(config.disabled_apis, 'api')) {
  const ServiceFabrikApiController = require('./ServiceFabrikApiController');
  exports.ServiceFabrikApiController = ServiceFabrikApiController;
  exports.serviceFabrikApi = new ServiceFabrikApiController();
}

if (!_.includes(config.disabled_apis, 'manage')) {
  const DashboardController = require('./DashboardController');
  exports.DashboardController = DashboardController;
  exports.dashboard = new DashboardController();
}



