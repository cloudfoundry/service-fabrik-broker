'use strict';

const ServiceBrokerApiController = require('./ServiceBrokerApiController');
const ServiceFabrikApiController = require('./ServiceFabrikApiController');
const ServiceFabrikAdminController = require('./ServiceFabrikAdminController');
const ServiceFabrikReportController = require('./ServiceFabrikReportController');
const DashboardController = require('./DashboardController');
/* Controller classes */
exports.ServiceBrokerApiController = ServiceBrokerApiController;
exports.ServiceFabrikApiController = ServiceFabrikApiController;
exports.ServiceFabrikAdminController = ServiceFabrikAdminController;
exports.ServiceFabrikReportController = ServiceFabrikReportController;
exports.DashboardController = DashboardController;
/* Controller instances */
exports.serviceBrokerApi = new ServiceBrokerApiController();
exports.serviceFabrikApi = new ServiceFabrikApiController();
exports.serviceFabrikAdmin = new ServiceFabrikAdminController();
exports.serviceFabrikReport = new ServiceFabrikReportController();
exports.dashboard = new DashboardController();