'use strict';
/* jshint camelcase:false */

const ip = require('ip');
const _ = require('lodash');

class Network {
  constructor(opts) {
    this.name = opts.name;
    this.subnet_name = opts.subnet_name;
    this.type = opts.type;
    this.cloud_properties = opts.cloud_properties;
  }

  toJSON() {
    return _.pick(this, ['name', 'type']);
  }

  static create(opts) {
    switch (opts.type) {
    case 'manual':
      return new ManualNetwork(opts);
    case 'dynamic':
      return new DynamicNetwork(opts);
    default:
      throw new Error('Invalid network type');
    }
  }
}

module.exports = Network;

class DynamicNetwork extends Network {
  constructor(opts) {
    super(opts);
  }

  toJSON() {
    if (this.cloud_properties) {
      return _.assign(super.toJSON(), {
        cloud_properties: this.cloud_properties
      });
    }
    return super.toJSON();
  }
}

class ManualNetwork extends Network {
  constructor(opts) {
    super(opts);
    this.cidr = new CIDR(opts.range);
    this.range = opts.range;
    this.dns = opts.dns;
    this.az = opts.az;
    let index = opts.index;
    let offset = opts.offset || 1;
    let size = opts.size || 2;
    let lower = (offset + index) * size;
    let upper = (offset + index + 1) * size - 1;
    let last = this.cidr.length - 2;
    this.gateway = opts.gateway || this.cidr.gateway;
    this.static = this.cidr.range(lower, upper);
    this.reserved = [];
    if (lower > 2) {
      this.reserved.push(`${ this.cidr.nth(2) } - ${ this.cidr.nth(lower - 1) }`);
    }
    if (upper < last) {
      this.reserved.push(`${ this.cidr.nth(upper + 1) } - ${ this.cidr.nth(last) }`);
    }
  }

  toJSON() {
    let subnet = {
      range: this.range,
      gateway: this.gateway,
      static: this.static,
      reserved: this.reserved
    };
    if (this.dns) {
      subnet.dns = this.dns;
    }
    if (this.cloud_properties) {
      subnet.cloud_properties = this.cloud_properties;
    }
    return _.assign(super.toJSON(), {
      subnets: [subnet]
    });
  }
}

class CIDR {
  constructor(range) {
    this.subnet = ip.cidrSubnet(range);
  }
  get ip() {
    return this.subnet.networkAddress;
  }
  get gateway() {
    return this.subnet.firstAddress;
  }
  get length() {
    return this.subnet.length;
  }
  nth(i) {
    return ip.fromLong(ip.toLong(this.ip) + i);
  }
  range(lower, upper) {
    let ips = [];
    for (let i = lower; i <= upper; i++) {
      ips.push(this.nth(i));
    }
    return ips;
  }
  toString() {
    return `${this.ip}/${this.subnet.subnetMaskLength}`;
  }
}