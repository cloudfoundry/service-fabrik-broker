const _ = require('lodash');
const BaseInstance = require('./BaseInstance');
const bosh = require('../bosh');
const BoshDirectorClient = bosh.BoshDirectorClient;
const mapper = require('./VirtualHostRelationMapper');

class VirtualHostInstance extends BaseInstance {

    constructor(guid, manager) {
        super(guid, manager);
        this.director = bosh.director;
        this.mapper = mapper.VirtualHostRelationMapper;
    }

    get async() {
        return false;
    }

    initialize(){
        return this.getDeploymentNameForVirtualHostInstanceId(this.guid)
            .then((deploymentName) => this.deploymentName = deploymentName)
    }

    create(params) {
        const rabbitmqInstanceName = params.parameters.dedicated_rabbitmq_instance;
        return this.cloudController.getServiceInstanceWithName(rabbitmqInstanceName, params.organization_guid, params.space_guid)
            .then((serviceInstance) => { 
                var serviceInstanceId = serviceInstance.resources[0].metadata.guid;
                return this.director.getDeploymentNameForInstanceId(serviceInstanceId);
            })
            .then((deploymentName) => {
                return this.manager
                    .createOrUpdateVirtualHost(deploymentName, params, this.guid);
            });
    }

    delete(params) {
        return this.initialize()
          .then(() => this.manager.verifyDeploymentLockStatus(this.deploymentName))
          .then(() => this.manager.deleteVirtualHost(this.deploymentName, this.guid));
    }

    bind(params) {
        return this
          .initialize()
          .then(() => this.manager.createBinding(this.deploymentName, this.guid, {
            id: params.binding_id,
            parameters: params.parameters || {}
          }))
    }

    unbind(params) {
        return this
          .initialize()
          .then(() => this.manager.deleteBinding(this.deploymentName, this.guid, params.binding_id));
    }

    getDeploymentNameForVirtualHostInstanceId(id){
        return this.mapper.getDeploymentName(`virtual_host_instance-${id}`);
    }

}
module.exports = VirtualHostInstance