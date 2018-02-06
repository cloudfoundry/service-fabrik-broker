'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const catalog = require('../models').catalog;
const Agent = require('./Agent');
const VirtualHostAgent = require('./VirtualHostAgent');
const DirectorManager = require('./DirectorManager');
const DockerManager = require('./DockerManager');
const VirtualHostManager = require('./VirtualHostManager');
const ServiceFabrikOperation = require('./ServiceFabrikOperation');
const FabrikStatusPoller = require('./FabrikStatusPoller');
const DBManager = require('./DBManager');
const OobBackupManager = require('./OobBackupManager');

class Fabrik {
  static createManager(plan) {
    return Promise
      .try(() => {
        switch (plan.manager.name) {
        case 'director':
          return DirectorManager;
        case 'docker':
          return DockerManager;
        case 'virtual_host':
          return VirtualHostManager;
        default:
          assert.fail(plan.manager.name, ['director', 'docker', 'virtual_host'], undefined, 'in');
        }
      })
      .then(managerConstructor => managerConstructor.load(plan));
  }

  static createInstance(instance_id, service_id, plan_id, platformManager) {
    const plan = catalog.getPlan(plan_id);
    assert.strictEqual(service_id, plan.service.id);
    return this
      .createManager(plan)
      .then(manager => manager.createInstance(instance_id, platformManager));
  }

  static createOperation(name, opts) {
    return new ServiceFabrikOperation(name, opts);
  }
}
Fabrik.Agent = Agent;
Fabrik.VirtualHostAgent = VirtualHostAgent;
Fabrik.DockerManager = DockerManager;
Fabrik.DirectorManager = DirectorManager;
Fabrik.ServiceFabrikOperation = ServiceFabrikOperation;
Fabrik.FabrikStatusPoller = FabrikStatusPoller;
Fabrik.dbManager = new DBManager();
Fabrik.oobBackupManager = OobBackupManager;
module.exports = Fabrik;