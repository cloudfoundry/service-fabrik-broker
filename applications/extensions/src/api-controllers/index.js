'use strict';

const ServiceFabrikApiController = require('./ServiceFabrikApiController');

module.exports = {
  ServiceFabrikApiController: ServiceFabrikApiController,
  serviceFabrikApi: new ServiceFabrikApiController()
};
