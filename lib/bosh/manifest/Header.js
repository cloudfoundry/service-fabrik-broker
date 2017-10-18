'use strict';
/* jshint camelcase:false */

const yaml = require('js-yaml');
const _ = require('lodash');
const config = require('../../config');

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
    let resource_pools_to_include = options.resource_pools || [];
    return new Header({
      name: this.name,
      director_uuid: this.director_uuid,
      releases: this.releases,
      compilation: this.compilation,
      disk_pools: this.constructor.filterDiskPools(this.disk_pools, disk_pool_names),
      resource_pools: this.constructor.filterResourcePools(this.resource_pools, resource_pools_to_include),
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

  static filterResourcePools(resource_pools, resource_pools_to_include) {
    const resource_pool_names = _.map(resource_pools_to_include, 'name');
    if (resource_pool_names && resource_pool_names.length) {
      return resource_pools.filter((resource_pool) => {
        let match = /^(.*)_[a-zA-Z0-9]+$/.exec(resource_pool.name);
        if (match) {
          let matched_attribute = _.filter(resource_pools_to_include, {
            'name': match[1]
          });
          if (matched_attribute.length > 0) {
            let cloud_properties = matched_attribute[0].cloud_properties;
            if (cloud_properties) {
              _.assign(resource_pool.cloud_properties, cloud_properties[config.backup.provider.name]);
            }
          }

          return _.includes(resource_pool_names, match[1]);
        }
        return false;
      });
    }
    return resource_pools;
  }
}

module.exports = Header;