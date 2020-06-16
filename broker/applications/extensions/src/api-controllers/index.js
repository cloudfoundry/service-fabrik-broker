'use strict';

const ServiceFabrikApiController = require('./ServiceFabrikApiController');
exports.ServiceFabrikApiController = ServiceFabrikApiController;
exports.serviceFabrikApi = new ServiceFabrikApiController();

const DashboardController = require('./DashboardController');
exports.DashboardController = DashboardController;
exports.dashboard = new DashboardController();



