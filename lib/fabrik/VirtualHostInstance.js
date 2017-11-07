const BaseInstance = require('./BaseInstance');
const bosh = require('../bosh');
const BoshDirectorClient = bosh.BoshDirectorClient;

class VirtualHostInstance extends BaseInstance {

    initialize(operation) {
        this.director = bosh.director;
    }

    create(params) {
        const operation = {
            type: 'create'
        };
        const rabbitmqInstanceName = params.parameters.dedicated_rabbitmq_instance;
        return this.cloudController.getServiceInstanceIdWithName(rabbitmqInstanceName, params.organization_guid, params.space_guid)
            .then((serviceInstanceId) => {
                return this.director.getDeploymentNameForInstanceId(serviceInstanceId);
            }).then((deploymentName) => {
                return this.manager
                    .createOrUpdateVirtualHost(deploymentName, params)
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