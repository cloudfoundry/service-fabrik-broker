'use strict';

const ServiceFabrikAdminController = require('./ServiceFabrikAdminController');

module.exports = {
  ServiceFabrikAdminController: ServiceFabrikAdminController,
  serviceFabrikAdmin: new ServiceFabrikAdminController()
};
