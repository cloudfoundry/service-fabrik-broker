'use strict';

const _ = require('lodash');
const assert = require('assert');
const CONST = require('../../../common/constants');
const config = require('../../../common/config');

class Addons {
  constructor(context) {
    this.networks = Array.isArray(context.networks) ? context.networks : [context.networks];
    this.context = context;
  }

  getAll() {
    const addOnList = _.get(config, 'service_addon_jobs', []);
    return _.map(addOnList, name => this.getAddOn(name));
  }

  getAddOn(type) {
    switch (type) {
      case CONST.ADD_ON_JOBS.IP_TABLES_MANAGER:
        return this.getIpTablesManagerJob();
      default:
        assert.fail(type, [CONST.ADD_ON_JOBS.IP_TABLES_MANAGER], `Invalid add-on job type. ${type} does not exist`);
    }
  }

  shouldEnableConnectivity() {
    const connectivityAllowedServicesList = _.get(this.context, 'connectivityAllowedServicesList');
    const serviceId = _.get(this.context, 'serviceId');
    if(_.findIndex(connectivityAllowedServicesList, serviceId) == -1) {
      return false;
    }
    return _.get(this.params, 'prepare_migration', false) || _.get(this.params, 'bucardo', false);
  }

  getIpTablesManagerJob() {
    let allowIpList = [],
      blockIpList = [];
    _.each(this.networks, net => {
      allowIpList = allowIpList.concat.apply(allowIpList, net.static);
      blockIpList.push(net.range);
    });
    return {
      name: CONST.ADD_ON_JOBS.IP_TABLES_MANAGER,
      jobs: [{
        name: CONST.ADD_ON_JOBS.IP_TABLES_MANAGER,
        release: _.get(config, 'release_name', CONST.SERVICE_FABRIK_PREFIX),
        properties: {
          enable_connection: this.shouldEnableConnectivity(),
          allow_ips_list: allowIpList.join(','),
          block_ips_list: blockIpList.join(',')
        }
      }]
    };
  }
}

module.exports = Addons;
