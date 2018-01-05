'use strict';

const _ = require('lodash');
const ip = require('ip');
const Promise = require('bluebird');
const bosh = require('../../../bosh');
const logger = require('../../../logger');
const BoshDirectorClient = require('../../../bosh/BoshDirectorClient');
const cloudConfigManager = bosh.cloudConfigManager;
const BaseAction = require('./BaseAction');

class ReserveIps extends BaseAction {
  static executePreCreate() {
    logger.info('Executing ReserveIPs......preCreate....');
    const directorName = _.sample(BoshDirectorClient.getActivePrimary()).name;
    return cloudConfigManager.fetchCloudConfigAndUpdate(this.updateCloudConfig, directorName);
  }

  static updateCloudConfig(cloudConfig) {
    return Promise.try(() => {
      const reservedIps = [];
      logger.info('Active Primary Cloud Config ..', cloudConfig);
      const serviceNetwork = _.head(_.filter(cloudConfig.networks, (network) => network.name === 'sf_bosh_services'));
      logger.info('Current service network definition ..', serviceNetwork);
      _.each(serviceNetwork.subnets, subnet => {
        const subnetInfo = ip.cidrSubnet(subnet.range);
        let ipReserved = false,
          reservedIp = subnetInfo.lastAddress;
        //subnet.reserved = [subnetInfo.firstAddress, subnetInfo.lastAddress];
        subnet.reserved = subnet.reserved || [subnetInfo.firstAddress, subnetInfo.lastAddress];
        do {
          reservedIp = ip.fromLong(ip.toLong(reservedIp) - 1);
          if (subnet.reserved.indexOf(reservedIp) === -1) {
            //TODO: To check if the IP from this reserved list is used or not.
            logger.info(`Last IP for the subnet : ${subnet.range} is - ${subnetInfo.lastAddress} & reserved Ip for this net is - ${reservedIp}`);
            reservedIps.push({
              range: subnet.range,
              az: subnet.az,
              reservedIp: reservedIp
            });
            subnet.reserved.push(reservedIp);
            ipReserved = true;
          }
        } while (!ipReserved && reservedIp !== subnetInfo.firstAddress);
      });
      logger.info('Reserved Ips...', reservedIps);
      return [cloudConfig, reservedIps];
    });
  }
  static executePostCreate() {}
  static executePreDelete() {}
  static executePostDelete() {}
}

module.exports = ReserveIps;