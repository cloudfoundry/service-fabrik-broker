'use strict';

const _ = require('lodash');
const path = require('path');

class VirtualHostStore {
  constructor(cloudProvider) {
    this.cloudProvider = cloudProvider;
    const keys = {
      virtualHost: [
        'instance_guid'
      ]
    };
    const root = 'virtual_hosts';
    this.filename = new Filename(keys, root);
  }

  get containerName() {
    return this.cloudProvider.containerName;
  }

  getFile(data) {
    const filename = this.filename.stringify(data);
    return this.cloudProvider.downloadJson(filename);
  }

  putFile(data) {
    const filename = this.filename.stringify(data);
    return this.cloudProvider
      .uploadJson(filename, data)
      .return(data);
  }

  removeFile(data) {
    const filename = this.filename.stringify(data);
    return this.cloudProvider.remove(filename);
  }

}

class Filename {
  constructor(keys, root) {
    this.keys = keys;
    this.root = root;
  }

  stringify(metadata) {
    const instance_guid = metadata.instance_guid;
    const operation = 'virtualHost';
    const basename = _
      .chain(this.keys)
      .get(operation)
      .map(key => {
        return metadata[key];
      })
      .join('.')
      .value() + '.json';
    return path.posix.join(
      this.root,
      instance_guid,
      basename
    );
  }
}

module.exports = VirtualHostStore;