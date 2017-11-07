const BaseInstance = require('./BaseInstance');
const bosh = require('../bosh');
const BoshDirectorClient = bosh.BoshDirectorClient;

class VirtualHostInstance extends BaseInstance {

    constructor(guid, manager) {
        super(guid, manager);
    }
    initialize(operation) {
        this.director = bosh.director;
    }

    create(params) {
        const operation = {
            type: 'create'
        };
        const rabbitmqInstanceName = params.parameters.dedicated_rabbitmq_instance;
        return this.cloudController.getServiceInstanceWithName(rabbitmqInstanceName, params.organization_guid, params.space_guid)
            .then((serviceInstance) => { 
                var serviceInstanceId = serviceInstance.resources[0].metadata.guid;
                return bosh.director.getDeploymentNameForInstanceId(serviceInstanceId);
            })
            .then((deploymentName) => {
                return this.manager
                    .createOrUpdateVirtualHost(deploymentName, params, this.guid)
                    .then(taskId => _
                        .chain(operation)
                        .assign(_.pick(params, 'parameters', 'space_guid'))
                        .set('task_id', taskId)
                        .value()
                    );
            });
    }
}
module.exports = VirtualHostInstance