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
    this.stemcells = header.stemcells;
    this.tags = header.tags;
  }
  
  toString() {
    return yaml.safeDump(this, {
      skipInvalid: true
    });
  }
}

module.exports = Header;