'use strict';

const _ = require('lodash');
const BoshDirectorClient = require('../../data-access-layer/bosh/BoshDirectorClient');

class Plan {
  constructor(service, options) {
    _
      .chain(this)
      .assign({
        service: service
      })
      .defaults(options, {
        metadata: undefined,
        free: true,
        credentials: {},
        syslog_drain_port: null,
        syslog_drain_protocol: 'syslog'
      })
      .value();
  }

  get stemcell() {
    return _
      .chain(this.manager.settings)
      .get('stemcell', {})
      .defaults(BoshDirectorClient.getInfrastructure().stemcell)
      .update('version', version => '' + version)
      .value();
  }

  get releases() {
    return _
      .chain(this.manager.settings)
      .get('releases')
      .map(release => _.pick(release, 'name', 'version'))
      .sortBy(release => `${release.name}/${release.version}`)
      .value();
  }

  get supportedFeatures() {
    return _.get(this.manager.settings, 'agent.supported_features');
  }

  get updatePredecessors() {
    return _.get(this.manager.settings, 'update_predecessors');
  }

  toJSON() {
    return _
      .chain(this)
      .pick(this.constructor.keys)
      .tap(plan => _.assign(plan.metadata, {
        update_predecessors: this.updatePredecessors,
        supported_features: this.supportedFeatures
      }))
      .value();
  }

  static get keys() {
    return [
      'id',
      'name',
      'description',
      'metadata',
      'free'
    ];
  }
}

module.exports = Plan;