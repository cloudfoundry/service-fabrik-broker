'use strict';

const _ = require('lodash');
const ip = require('ip');
const utils = require('../../broker/lib/utils');
const BoshDirectorClient = require('./BoshDirectorClient');
const CONST = require('../../common/constants');

const NetworkSegmentIndexLength = CONST.NETWORK_SEGMENT_LENGTH;

class NetworkSegmentIndex {
  static adjust(i, n) {
    return _.padStart(i, n || NetworkSegmentIndex.LENGTH, '0');
  }

  static findFreeIndex(deployments, subnet) {
    return _.sample(NetworkSegmentIndex.getFreeIndices(deployments, subnet));
  }

  static getFreeIndices(deployments, subnet) {
    let usedIndices = NetworkSegmentIndex.getUsedIndices(deployments, subnet);
    let freeIndices = [];
    let capacity = NetworkSegmentIndex.capacity(subnet);
    for (let i = 0; i < capacity; i++) {
      if (usedIndices.indexOf(i) < 0) {
        freeIndices.push(i);
      }
    }
    return freeIndices;
  }

  static getUsedIndices(deployments, subnet) {
    let indices = [];
    deployments.forEach((deployment) => {
      let deploymentName = _.isString(deployment) ? deployment : deployment.name;
      let match = utils.deploymentNameRegExp(subnet).exec(deploymentName);
      if (match) {
        indices.push(parseInt(match[2]));
      }
    });
    return indices.sort();
  }
}

NetworkSegmentIndex.LENGTH = NetworkSegmentIndexLength;
NetworkSegmentIndex.UPPER_BOUND = Math.pow(10, NetworkSegmentIndexLength) - 1;
NetworkSegmentIndex.capacity = calculateCapacity;

module.exports = NetworkSegmentIndex;

function calculateCapacity(subnet) {
  let infrastructure = BoshDirectorClient.getInfrastructure();
  let segmentation = infrastructure.segmentation;
  let networks = infrastructure.networks;
  let capacity = segmentation.capacity;
  if (!capacity || capacity < 1) {
    let name = subnet || segmentation.network_name || 'default';
    let minSubnetSize = Number.POSITIVE_INFINITY;
    networks.find((net) => {
      return net.name === name;
    }).subnets.forEach((subnet) => {
      let length = ip.cidrSubnet(subnet.range).length;
      if (length < minSubnetSize) {
        minSubnetSize = length;
      }
    });
    let size = segmentation.size || 2;
    let offset = segmentation.offset || 1;
    capacity = (minSubnetSize / size) - offset - 1;
  }
  return Math.min(capacity, NetworkSegmentIndex.UPPER_BOUND + 1);
}