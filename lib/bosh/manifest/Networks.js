'use strict';

const _ = require('lodash');
const Network = require('./Network');
const CONST = require('../../constants');
const logger = require('../../logger');

const DEFAULT_OFFSET = 1;
const DEFAULT_SIZE = 2;

class Networks {

  constructor(networks, index, defaultSegmentationOptions, ipManagement) {
    this.all = [];
    networks = networks || [];
    index = index || 0;
    defaultSegmentationOptions = defaultSegmentationOptions || {};
    networks.forEach(network => {
      if (ipManagement && network.ip_management !== ipManagement) {
        return true;
      }
      if (!network.subnets) {
        const net = Network.create(network);
        this.all.push(net);
        this[net.name] = net;
      } else {
        const networkSegmentation = network.segmentation || defaultSegmentationOptions;
        const nets = network.subnets.map(subnet => {
          const net = Network.create(_.assign({
            name: network.name,
            subnet_name: `${network.name}_${subnet.az}`,
            ip_management: network.ip_management,
            type: network.type,
            index: index,
            offset: networkSegmentation.offset || defaultSegmentationOptions.offset || DEFAULT_OFFSET,
            size: networkSegmentation.size || defaultSegmentationOptions.size || DEFAULT_SIZE,
          }, subnet));
          this.all.push(net);
          this[net.subnet_name] = net;
          return net;
        });
        this[network.name] = nets;
      }
    });
  }

  get manual() {
    return this.all.filter(net => net.type === 'manual');
  }
  get dynamic() {
    return this.all.filter(net => net.type === 'dynamic');
  }

  slice() {
    return Array.prototype.slice.apply(this.manual, arguments);
  }

  each() {
    Array.prototype.forEach.apply(this.manual, arguments);
  }

}

module.exports = Networks;