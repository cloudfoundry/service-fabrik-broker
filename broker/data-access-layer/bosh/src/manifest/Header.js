'use strict';
/* jshint camelcase:false */

const yaml = require('js-yaml');

class Header {
  constructor(header) {
    this.name = header.name;
    this.director_uuid = header.director_uuid;
    this.releases = header.releases || [];
    if (header.release_name && header.release_version) {
      this.releases.push({
        name: header.release_name,
        version: header.release_version
      });
    }
    this.stemcells = header.stemcells;
    this.tags = header.tags;
  }

  toString() {
    return yaml.dump(this, {
      skipInvalid: true
    });
  }
}

module.exports = Header;
