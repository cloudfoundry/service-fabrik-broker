const _ = require('lodash');
const VirtualHostInstance = require('./VirtualHostInstance');
const BaseManager = require('./BaseManager');
const VirtualHostAgent = require('./VirtualHostAgent');
const logger = require('../logger');

class VirtualHostManager extends BaseManager{
    constructor(plan) {
        super(plan);
        this.agent = new VirtualHostAgent(this.settings.agent);
    }
    verifyFeatureSupport(feature) {
        if (!_.includes(this.agent.features, feature)) {
          throw new NotImplemented(`Feature '${feature}' not supported`);
        }
    }
    createOrUpdateVirtualHost(deploymentName, params, args) {
        this.verifyFeatureSupport('multi_tenancy');
        logger.info(`Creating virtual host for deployment '${deploymentName}'...`);
        return this.getDeploymentIps(deploymentName)
          .then(ips => this.agent.provision(ips))
          .tap(credentials => this.createVirtualHostInstanceProperty(deploymentName, binding.id, _.set(binding, 'credentials', credentials)))
          .catch(err => {
            logger.error('+-> Failed to create virtual host');
            logger.error(err);
            throw err;
          });
    }
    static get instanceConstructor() {
        return VirtualHostInstance;
      }

    static load(plan) {
        if (!this[plan.id]) {
          this[plan.id] = new this(plan);
        }
        return Promise.resolve(this[plan.id]);
      }
}
module.exports = VirtualHostManager;