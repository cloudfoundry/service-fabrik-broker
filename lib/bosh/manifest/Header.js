'use strict';
/* jshint camelcase:false */

const yaml = require('js-yaml');
const _ = require('lodash');

class Header {
  constructor(header) {
    this.name = header.name;
    this.director_uuid = header.director_uuid;
    this.releases = header.releases || [];
    this.compilation = header.compilation;
    this.disk_pools = header.disk_pools;
    this.resource_pools = header.resource_pools;
    this.networks = header.networks;
  }

  select(options) {
    let disk_pool_names = options.disk_pools || [];
    let resource_pool_names = options.resource_pools || [];
    return new Header({
      name: this.name,
      director_uuid: this.director_uuid,
      releases: this.releases,
      compilation: this.compilation,
      disk_pools: this.constructor.filterDiskPools(this.disk_pools, disk_pool_names),
      resource_pools: this.constructor.filterResourcePools(this.resource_pools, resource_pool_names),
      networks: this.networks
    });
  }

  toString() {
    return yaml.safeDump(this, {
      skipInvalid: true
    });
  }

  static filterDiskPools(disk_pools, disk_pool_names) {
    if (disk_pool_names && disk_pool_names.length) {
      return disk_pools.filter((disk_pool) => {
        return _.includes(disk_pool_names, disk_pool.name);
      });
    }
    return disk_pools;
  }

  static filterResourcePools(resource_pools, resource_pool_names) {
    if (resource_pool_names && resource_pool_names.length) {
      return resource_pools.filter((resource_pool) => {
        let match = /^(.*)_[a-zA-Z0-9]+$/.exec(resource_pool.name);
        if (match) {
          return _.includes(resource_pool_names, match[1]);
        }
        return false;
      });
    }
    return resource_pools;
  }
}

module.exports = Header;