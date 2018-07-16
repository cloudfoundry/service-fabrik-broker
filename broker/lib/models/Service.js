'use strict';

const _ = require('lodash');
const Plan = require('./Plan');
const config = require('../../../common/config');
const CONST = require('../../../common/constants');

class Service {
  constructor(options) {
    _(this)
      .chain()
      .assign({
        plans: _.map(options.plans, plan => {
          if (plan.manager.name === CONST.INSTANCE_TYPE.DIRECTOR && config.cred_provider &&
            _.get(plan, 'manager.settings.context.agent.provider.credhub_key', undefined) !== undefined) {
            //Inject credhub config into agent properties in case credhub is configured for the service
            _.assign(_.get(plan, 'manager.settings.context.agent.provider'),
              _.omit(config.cred_provider, 'credhub_username', 'credhub_user_password'));
          }
          return new Plan(this, plan);
        })
      })
      .defaults(options, {
        bindable: true,
        subnet: null,
        tags: [],
        metadata: null,
        requires: [],
        plan_updateable: true,
        dashboard_client: {},
        application_access_ports: null
      })
      .value();
  }

  toJSON() {
    return _
      .chain({})
      .assign(_.pick(this, this.constructor.keys))
      .set('plans', _.filter(this.plans, plan => plan.name.indexOf('-fabrik-internal') === -1))
      .value();
  }

  static get keys() {
    return [
      'id',
      'name',
      'description',
      'bindable',
      'subnet',
      'tags',
      'metadata',
      'requires',
      'plan_updateable',
      'dashboard_client',
      'application_access_ports'
    ];
  }
}

module.exports = Service;