const _ = require('lodash');
const bosh = require('../bosh');
const BoshDirectorClient = bosh.BoshDirectorClient;
const VirtualHostInstance = require('./VirtualHostInstance');
const BaseManager = require('./BaseManager');
const VirtualHostAgent = require('./VirtualHostAgent');
const logger = require('../logger');
const errors = require('../errors');
const BadRequest = errors.BadRequest;
const VirtualHostInstanceToDeploymentRelationAlreadyExists = errors.VirtualHostInstanceToDeploymentRelationAlreadyExists;

class VirtualHostManager extends BaseManager{

    constructor(plan) {
        super(plan);
        this.director = bosh.director;
        this.agent = new VirtualHostAgent(this.settings.agent);
    }

    verifyFeatureSupport(feature) {
        if (!_.includes(this.agent.features, feature)) {
          throw new NotImplemented(`Feature '${feature}' not supported`);
        }
    }

    getDeploymentManifest(deploymentName) {
        logger.info(`Fetching deployment manifest '${deploymentName}'...`);
        return this.director
          .getDeploymentManifest(deploymentName)
          .tap(() => logger.info('+-> Fetched deployment manifest'))
          .catch(err => {
            logger.error('+-> Failed to fetch deployment manifest');
            logger.error(err);
            throw err;
          });
    }

    getDeploymentIps(deploymentName) {
        return this.getDeploymentManifest(deploymentName)
          .tap(manifest => {
            if (_.isNil(manifest)) {
              throw new ServiceInstanceNotOperational(this.getInstanceGuid(deploymentName));
            }
          })
          .then(manifest => _
            .chain(manifest.jobs)
            .map(job => _.map(job.networks, net => net.static_ips))
            .flattenDeep()
            .value()
          );
    }

    createOrUpdateVirtualHost(deploymentName, params, guid) {
        this.verifyFeatureSupport('multi_tenancy');
        logger.info(`Creating virtual host for deployment '${deploymentName}'...`);
        return this.getDeploymentIps(deploymentName)
          .then(ips => this.agent.provision(ips, guid))
          .tap(credentials => this.saveVirtualHostInstanceToDeploymentRelation(deploymentName, guid))
          .catch(err => {
            logger.error('+-> Failed to create virtual host');
            logger.error(err);
            throw err;
          });
    }

    saveVirtualHostInstanceToDeploymentRelation(deploymentName, id) {
        return this.director
          .createDeploymentProperty(deploymentName, `virtual_host_instance-${id}`, JSON.stringify({}))
          .catchThrow(BadRequest, new VirtualHostInstanceToDeploymentRelationAlreadyExists(deploymentName, id));
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