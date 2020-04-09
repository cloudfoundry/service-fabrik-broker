'use strict';

const ServiceBrokerClient = require('./ServiceBrokerClient');
const serviceBrokerClient = new ServiceBrokerClient();

module.exports = {
  ServiceBrokerClient,
  serviceBrokerClient
};
