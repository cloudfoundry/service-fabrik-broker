'use strict';
/* jshint camelcase:false */

const yaml = require('js-yaml');

class Header {
  constructor(header) {
    this.name = header.name;
    this.releases = header.releases || [];
    this.stemcells = header.stemcells;
  }

  select() {
    return new Header({
      name: this.name,
      releases: this.releases,
      stemcells : this.stemcells,
    });
  }

  toString() {
    return yaml.safeDump(this, {
      skipInvalid: true
    });
  }
}

module.exports = Header;