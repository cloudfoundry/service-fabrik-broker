'use strict';

const _ = require('lodash');

class DockerPortRegistry {
  constructor(portRange) {
    this.range = _.range(_.first(portRange), _.last(portRange));
    this.reset();
    this.threshold = 256;
  }

  reset() {
    this.protocols = {
      tcp: [33331]
    };
  }

  willBeExhaustedSoon(protocol) {
    const ports = this.getPorts(protocol || 'tcp');
    return this.range.length - ports.length < this.threshold;
  }

  getPorts(protocol) {
    if (!this.protocols[protocol]) {
      this.protocols[protocol] = [];
    }
    return this.protocols[protocol];
  }

  sample(protocol) {
    const ports = this.getPorts(protocol);
    const port = _.sample(_.difference(this.range, ports));
    if (port) {
      this.insert(protocol, port);
    }
    return port;
  }

  insert(protocol, port) {
    const ports = this.getPorts(protocol);
    if (_.indexOf(ports, port) === -1) {
      ports.splice(_.sortedIndex(ports, port), 0, port);
    }
  }

  remove(protocol, port) {
    const ports = this.getPorts(protocol);
    _.pull(ports, port);
  }

  update(containers) {
    if (containers && containers.length) {
      this.reset();
      containers.forEach(container => {
        container.Ports.forEach(port => {
          this.insert(port.Type, port.PublicPort);
        });
      });
    }
  }
}

module.exports = DockerPortRegistry;
