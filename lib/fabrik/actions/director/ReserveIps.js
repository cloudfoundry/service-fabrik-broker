'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const bosh = require('../../../bosh');
const logger = require('../../../logger');
const CONST = require('../../../constants');
const config = require('../../../config');
const errors = require('../../../errors');
const BoshDirectorClient = require('../../../bosh/BoshDirectorClient');
const Repository = require('../../../db').Repository;
const cloudConfigManager = bosh.cloudConfigManager;
const BaseAction = require('./BaseAction');

class ReserveIps extends BaseAction {
  /* jshint unused:false */
  static executePreCreate(instanceId, deploymentName, reqParams, sfOperationArgs) {
    logger.info(`Executing ReserveIPs.preCreate for ${instanceId} - ${deploymentName}`);
    const directorName = _.sample(BoshDirectorClient.getActivePrimary()).name;
    const cloudConfigName = BoshDirectorClient.getInfrastructure().segmentation.network_name || 'default';
    return cloudConfigManager.getCloudConfig(directorName)
      .then(cloudConfig => this.reserveIp(cloudConfig, instanceId));
  }

  static getUsedIps() {
    function getAllUsedIps(ipList, offset, modelName, searchCriteria) {
      if (offset < 0) {
        return Promise.resolve([]);
      }
      const paginateOpts = {
        records: config.mongodb.record_max_fetch_count,
        offset: offset
      };
      return Repository.search(modelName, searchCriteria, paginateOpts)
        .then((result) => {
          ipList.push.apply(ipList, _.map(result.list, (reservedIp) => _.pick(reservedIp, 'ip', 'subnet_range')));
          return getAllUsedIps(ipList, result.nextOffset, modelName, searchCriteria);
        });
    }
    const result = [];
    return getAllUsedIps(result, 0, CONST.DB_MODEL.RESERVED_IP, {})
      .then(() => result);
  }

  static reserveIp(cloudConfig, instanceId) {
    const cloudConfigName = BoshDirectorClient.getInfrastructure().segmentation.network_name || 'default';
    return this
      .getUsedIps()
      .then((usedIps) => {
        const serviceNetwork = _.head(_.filter(cloudConfig.networks, (network) => network.name === cloudConfigName));
        logger.info('Current service network definition ..', serviceNetwork);
        assert.ok(serviceNetwork, `network definition for '${cloudConfigName}' not found in cloud config`);
        const ipsToBeReserved = [];
        _.each(serviceNetwork.subnets, subnet => {
          //subnet.reserved = [subnetInfo.firstAddress, subnetInfo.lastAddress];
          //TODO: reserved IPs per schema can have IP/CIDR. For purpose of POC this is just treated as having IPs. Might need to handle even CIDR if required.
          //subnet.reserved;
          const usedIpsForSubnet = _.chain(usedIps)
            .filter((reservedIp) => reservedIp.subnet_range === subnet.range)
            .map('ip')
            .value();
          const unUsedIp = _
            .chain(subnet.reserved)
            .difference(usedIpsForSubnet)
            .sample()
            .value();
          if (unUsedIp === undefined) {
            throw new errors.UnprocessableEntity('Cannot reserve Ips as the list is exhausted. Add more IPs to reserved config.');
          }
          ipsToBeReserved.push({
            instanceId: instanceId,
            ip: unUsedIp,
            subnet_range: subnet.range
          });
        });
        logger.info('Ips to be reserved...', ipsToBeReserved);
        return Promise
          .map(ipsToBeReserved, (reservedIp) => Repository.save(CONST.DB_MODEL.RESERVED_IP, reservedIp, CONST.SYSTEM_USER))
          .return(_.map(ipsToBeReserved, (data) => _.pick(data, 'ip', 'subnet_range')));
      });
  }
  static executePostCreate() {}
  static executePreDelete() {}
  static executePostDelete() {}
}

module.exports = ReserveIps;