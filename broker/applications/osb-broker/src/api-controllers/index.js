'use strict';

const ServiceBrokerApiController = require('./ServiceBrokerApiController');

module.exports = {
  ServiceBrokerApiController: ServiceBrokerApiController,
  serviceBrokerApi: new ServiceBrokerApiController()
};
