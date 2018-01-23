'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const ip = require('ip');
const bosh = require('../bosh');
const BoshDirectorClient = bosh.BoshDirectorClient;
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const Networks = bosh.manifest.Networks;
const CONST = require('../constants');
const logger = require('../logger');
const config = require('../config');
const cf = require('../cf');
const utils = require('../utils');
const catalog = require('../models/catalog');
const Repository = require('../db/Repository');

class IpManager {
  constructor() {
    this.director = bosh.director;
    this.networkName = BoshDirectorClient.getInfrastructure().segmentation.network_name || 'default';
    this.cloudController = cf.cloudController;
  }

  //Returns a map of subnet (keyed by range) & the free IPs that can be used in that subnet.
  getIpsToBeReserved() {
    const segmentation = BoshDirectorClient.getInfrastructure().segmentation;
    const noOfIpsToBeReserved = segmentation.no_of_reserved_ip;
    return Promise.all([
        this.director.getDeploymentNames(true),
        this.getPgInstances()
      ])
      .spread((deploymentNames, pgInstances) => {
        const ipUsedByInstanceMap = _.assign({},
          this.getIpsUsedByDeploymentsForNeutronPort(deploymentNames, pgInstances),
          this.getBlockedIpsReservedForSystem());
        return this.updateUsedIpsInMongo(ipUsedByInstanceMap)
          .then((usedIpMap) => {
            //const ipsToReserve = {};
            const freeIndices = NetworkSegmentIndex.getFreeIndices(deploymentNames);
            const numberOfIndicesToBeReserved = Math.ceil(noOfIpsToBeReserved / segmentation.size);
            logger.info(`Number of indices to be reserved  - ${numberOfIndicesToBeReserved} - ips to be reserved - ${noOfIpsToBeReserved}`);
            for (let k = 1; k <= numberOfIndicesToBeReserved; k++) {
              const servicesNetwork = _.filter(BoshDirectorClient.getInfrastructure().networks, (network) => network.name === this.networkName);
              const networks = new Networks(servicesNetwork, freeIndices[freeIndices.length - k], BoshDirectorClient.getInfrastructure().segmentation);
              for (let x = 0; x < networks.all.length; x++) {
                const subnetInfo = networks.all[x];
                usedIpMap[subnetInfo.range].push.apply(usedIpMap[subnetInfo.range], subnetInfo.static);
              }
              if (usedIpMap[networks.all[0].range].length >= noOfIpsToBeReserved) {
                logger.info(`hit the limit of noOfIpsTobeReserved - ${usedIpMap[networks.all[0].range].length}. Done!`);
                break;
              }
            }
            logger.info('Ips to reserve ...', usedIpMap);
            return usedIpMap;
          });
      });
  }

  getUsedIps() {
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

  updateUsedIpsInMongo(ipUsedByInstanceMap) {
    //Method is made idempotent. It does nothing if invoked repeatedly.
    const usedIpMap = {};
    return this.getUsedIps()
      .then((usedIpsInMongo) => {
        usedIpsInMongo = _.map(usedIpsInMongo, data => data.ip);
        const usedIps = _.keys(ipUsedByInstanceMap);
        const ipsToBeMarkedAsUsedInMongo = [];
        _.each(usedIps, usedIp => {
          const subnetRange = ipUsedByInstanceMap[usedIp].subnet_range;
          if (_.indexOf(usedIpsInMongo, usedIp) === -1) {
            ipsToBeMarkedAsUsedInMongo.push({
              instanceId: ipUsedByInstanceMap[usedIp].instanceId,
              ip: usedIp,
              subnet_range: ipUsedByInstanceMap[usedIp].subnet_range
            });
          }
          usedIpMap[subnetRange] = usedIpMap[subnetRange] || [];
          usedIpMap[subnetRange].push(usedIp);
        });
        if (ipsToBeMarkedAsUsedInMongo.length > 0) {
          logger.info('Reserved IPs to be flagged as used in mongodb :', ipsToBeMarkedAsUsedInMongo);
          return Repository
            .insertMany(CONST.DB_MODEL.RESERVED_IP, ipsToBeMarkedAsUsedInMongo, CONST.SYSTEM_USER)
            .return(usedIpMap);
        }
        logger.info('All used ips & system reserved ips already udpated in mongodb.');
        return usedIpMap;
      });
  }

  getPgInstances() {
    return Promise.try(() => {
      const pgsqlServiceGuid = '24731fb8-7b84-4f57-914f-c3d55d793dd4'; //'6db542eb-8187-4afc-8a85-e08b4a3cc24e';
      const pgPlans = catalog.getService(pgsqlServiceGuid).plans;
      logger.info('Plans to retrieve from CF ...', pgPlans);
      const pgDirectorPlanIds = _
        .chain(pgPlans)
        .filter(plan => plan.manager.name === 'director')
        .map(plan => plan.id)
        .value();
      logger.info('Retrieving Plans with guids ...', pgDirectorPlanIds);
      return this
        .cloudController
        .getAllPlanGuidsFromPlanIDs(pgDirectorPlanIds)
        .then(planGuids => planGuids.join(','))
        .tap(planGuids => logger.info(`Plan Guids to be queried are : ${planGuids}`))
        .then(commaSeperatePlanGuids => this.cloudController
          .getServiceInstancesWithPlansGuids(commaSeperatePlanGuids));
    });
  }

  deploymentNameRegExp() {
    //TODO: The below regex does not take care of IOT deployments. (which have subnet in them)
    return new RegExp(`^(${CONST.SERVICE_FABRIK_PREFIX})-([0-9]{${CONST.NETWORK_SEGMENT_LENGTH}})-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$`);
  }
  getIpsUsedByDeploymentsForNeutronPort(deploymentNames, pgInstances) {
    const usedIndices = [];
    const instanceIdNetworkSegmentIdxMap = {};
    _.each(deploymentNames, deploymentName => {
      let match = this.deploymentNameRegExp().exec(deploymentName);
      if (match) {
        const networkSegmentIdx = parseInt(match[2]);
        logger.info(`deploymentName - ${deploymentName} -> index ${match[2]} : guid -> ${match[3]}`);
        if (_.find(pgInstances, (instance) => instance.metadata.guid === match[3])) {
          usedIndices.push(networkSegmentIdx);
          instanceIdNetworkSegmentIdxMap[networkSegmentIdx] = match[3];
        }
      }
    });
    const ipUsedByInstanceMap = {};
    const servicesNetwork = _.filter(BoshDirectorClient.getInfrastructure().networks, (network) => network.name === this.networkName);
    _.each(usedIndices, index => {
      const networks = new Networks(servicesNetwork, index, BoshDirectorClient.getInfrastructure().segmentation);
      logger.info(`Fetching neutron port ip for index ${index} - `, networks.all[0]);
      for (let x = 0; x < networks.all.length; x++) {
        const subnetInfo = networks.all[x];
        //6th Ip is used for neutron port creation by PGSQL.
        ipUsedByInstanceMap[subnetInfo.static[5]] = {
          instanceId: instanceIdNetworkSegmentIdxMap[index],
          subnet_range: subnetInfo.range
        };
      }
    });
    logger.info('Ips used by neutron port by current deployments - ', ipUsedByInstanceMap);
    return ipUsedByInstanceMap;
  }

  getBlockedIpsReservedForSystem() {
    const ipReservedForSystem = {};
    const segmentation = BoshDirectorClient.getInfrastructure().segmentation;
    const offSetSize = segmentation.offset * segmentation.size;
    const subnets = [];
    //const network = _.find(BoshDirectorClient.getInfrastructure().networks, network => network.name === this.networkName);
    const network = _.find(BoshDirectorClient.getInfrastructure().networks, (network) => network.name === this.networkName);
    _.each(network.subnets, subnet => {
      logger.info(`sub network config - ${subnet.range}`);
      subnets.push({
        subnetInfo: ip.cidrSubnet(subnet.range),
        range: subnet.range
      });
    });
    //First 8 indexes and last index are reserved in static ip mechanism.
    for (let k = 0; k < offSetSize; k++) {
      for (let x = 0; x < subnets.length; x++) {
        const systemIp = ip.fromLong(ip.toLong(subnets[x].subnetInfo.networkAddress) + k);
        ipReservedForSystem[systemIp] = {
          instanceId: 'System',
          subnet_range: subnets[x].range
        };
      }
    }
    const capacity = (NetworkSegmentIndex.capacity() + 1) * segmentation.size;
    //push in last segment ip address.
    for (let k = capacity; k < capacity + segmentation.size; k++) {
      for (let x = 0; x < subnets.length; x++) {
        const systemIp = ip.fromLong(ip.toLong(subnets[x].subnetInfo.networkAddress) + k);
        ipReservedForSystem[systemIp] = {
          instanceId: 'System',
          subnet_range: subnets[x].range
        };
      }
    }
    logger.info('Ips reserved by current system offsets - ', ipReservedForSystem);
    return ipReservedForSystem;
  }
}

module.exports = new IpManager();