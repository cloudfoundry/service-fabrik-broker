'use strict';

const _ = require('lodash');
const config = require('@sf/app-config');
const { CONST } = require('@sf/common-utils');

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
      .defaults(_.get(_.first(_.filter(config.directors, function (director) {
        return director.primary && director.support_create;
      })), 'infrastructure.stemcell'))
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
    return _.get(this.manager, 'settings.agent.supported_features');
  }

  get updatePredecessors() {
    return _.get(this.manager, 'settings.update_predecessors');
  }

  get resourceGroup() {
    return _.get(this.manager, 'resource_mappings.resource_group');
  }

  get resourceType() {
    return _.get(this.manager, 'resource_mappings.resource_type');
  }

  get bindResourceGroup() {
    return _.get(this.manager, 'resource_mappings.bind.resource_group');
  }

  get bindResourceType() {
    return _.get(this.manager, 'resource_mappings.bind.resource_type');
  }

  get restoreResourceGroup() {
    return _.get(this.manager, 'resource_mappings.restore.resource_group', undefined) || CONST.APISERVER.RESOURCE_GROUPS.RESTORE;
  }

  get restoreResourceType() {
    return _.get(this.manager, 'resource_mappings.restore.resource_type', undefined) || CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE;
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
      'maintenance_info',
      'schemas',
      'free',
      'maximum_polling_duration',
      'bindable',
      'asyncBinding'
    ];
  }
}

module.exports = Plan;
