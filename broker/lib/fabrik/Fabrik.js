'use strict';

const Agent = require('../../../data-access-layer/service-agent');
const DBManager = require('./DBManager');
const OobBackupManager = require('./OobBackupManager');
const catalog = require('../../../common/models/catalog');
const DirectorService = require('../../../operators/bosh-operator/DirectorService');
const DockerService = require('../../../operators/docker-operator/DockerService');
const VirtualHostService = require('../../../operators/virtualhost-operator/VirtualHostService');

class Fabrik {
  //Kept this function here as of now, we can displace it based on what we decide to do about lib/fabrik
  //review comments are requested
  static createService(plan_id, instance_id, context) {
    const plan = catalog.getPlan(plan_id);
    switch (plan.manager.name) {
  
      case CONST.INSTANCE_TYPE.DIRECTOR:
        return new DirectorService(plan, instance_id);
  
      case CONST.INSTANCE_TYPE.DOCKER:
        if (config.enable_swarm_manager) {
          return new DockerService(instance_id, plan);
        } else {
          assert.fail(plan.manager.name, [CONST.INSTANCE_TYPE.DIRECTOR, CONST.INSTANCE_TYPE.VIRTUAL_HOST], undefined, 'in');
        }
        break;
  
      case CONST.INSTANCE_TYPE.VIRTUAL_HOST:
        //space_guid is not really necessary here for dashboard rendering
        return new VirtualHostService(instance_id, _.get(context, "space_guid"), plan);
  
      default:
        assert.fail(plan.manager.name, [CONST.INSTANCE_TYPE.DIRECTOR, CONST.INSTANCE_TYPE.DOCKER, CONST.INSTANCE_TYPE.VIRTUAL_HOST], undefined, 'in');
    }
  } 
}

Fabrik.Agent = Agent;
Fabrik.dbManager = new DBManager();
Fabrik.oobBackupManager = OobBackupManager;
module.exports = Fabrik;