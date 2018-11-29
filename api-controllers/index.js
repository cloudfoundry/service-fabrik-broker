'use strict';

const config = require('../common/config');
const _ = require('lodash');

if (!_.includes(config.disabled_apis, 'broker')) {
    const ServiceBrokerApiController = require('./ServiceBrokerApiController');
    exports.ServiceBrokerApiController = ServiceBrokerApiController;
    exports.serviceBrokerApi = new ServiceBrokerApiController();
}
if (!_.includes(config.disabled_apis, 'api')) {
    const ServiceFabrikApiController = require('./ServiceFabrikApiController');
    exports.ServiceFabrikApiController = ServiceFabrikApiController;
    exports.serviceFabrikApi = new ServiceFabrikApiController();
}
if (!_.includes(config.disabled_apis, 'admin')) {
    const ServiceFabrikAdminController = require('./ServiceFabrikAdminController');
    exports.ServiceFabrikAdminController = ServiceFabrikAdminController;
    exports.serviceFabrikAdmin = new ServiceFabrikAdminController();
}
if (!_.includes(config.disabled_apis, 'manage')) {
    const DashboardController = require('./DashboardController');
    exports.DashboardController = DashboardController;
    exports.dashboard = new DashboardController();
}