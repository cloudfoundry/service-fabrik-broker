'use strict';
/* jshint camelcase:false */

const yaml = require('js-yaml');
const config = require('../../config');

class Header {
  constructor(header) {
    this.name = header.name;
    this.director_uuid = header.director_uuid;
    this.releases = header.releases || [];
    if (config.release_name && config.release_version) {
      this.releases.push({
        name: config.release_name,
        version: config.release_version
      });
    }
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