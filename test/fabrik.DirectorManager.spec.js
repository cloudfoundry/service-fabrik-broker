'use strict';

const lib = require('../lib');
const config = lib.config;
const catalog = lib.models.catalog;
const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const errors = require('../lib/errors');
const CONST = require('../lib/constants');
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const fs = require('fs');
const path = require('path');

var used_guid = '4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9';
var free_guid = '87599704-adc9-1acd-0be9-795e6a3bc803';
var boshStub = {
  NetworkSegmentIndex: {
    adjust: function (num) {
      return num;
    },
    findFreeIndex: function () {
      return 2;
    }
  },
  director: {
    getDeploymentNames: function () {
      return Promise.resolve([`service-fabrik-0021-${used_guid}`]);
    },
    getDeploymentNameForInstanceId: function () {
      return Promise.resolve([`service-fabrik-0021-${used_guid}`]);
    }
  }
};

var DirectorManager = proxyquire('../lib/fabrik/DirectorManager', {
  '../bosh': boshStub,
});

describe('fabrik', function () {
  describe('DirectorManager', function () {
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const xsmall_plan_id = plan_id;
    const small_plan_id = 'bc158c9a-7934-401e-94ab-057082a5073e';
    let return_value;
    let manager;

    before(function () {
      manager = new DirectorManager(catalog.getPlan(plan_id));
    });

    describe('#getDeploymentName', function () {
      it('should append guid and network segment index to deployment name', function () {
        expect(manager.plan.id).to.eql(plan_id);
        expect(manager.getDeploymentName(used_guid, '90')).to.eql(`service-fabrik-90-${used_guid}`);
        manager.aquireNetworkSegmentIndex(used_guid)
          .catch(err => expect(err).to.be.instanceof(ServiceInstanceAlreadyExists));
        manager.aquireNetworkSegmentIndex(free_guid).then(index => expect(index).to.eql(2));
      });
    });
    describe('#findNetworkSegmentIndex', function () {
      it('should append guid and network segment index to deployment name', function () {
        manager.findNetworkSegmentIndex(used_guid).then(res => expect(res).to.eql(21));
      });
    });
    describe('#isRestorePossible', function () {
      it('should return false when plan not in restore_predecessors', function () {
        // restore not possible from small to xsmall
        manager = new DirectorManager(catalog.getPlan(xsmall_plan_id));
        manager.update_predecessors = [];
        return_value = expect(manager.isRestorePossible(small_plan_id)).to.be.false;
      });
      it('should return true when plan not in restore_predecessors', function () {
        // restore possible from xsmall to small
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        manager.update_predecessors = [xsmall_plan_id];
        return_value = expect(manager.isRestorePossible(xsmall_plan_id)).to.be.true;
      });
    });
    describe('#restorePredecessors', function () {
      it('should return update_predecessors if restore_predecessors is not defined', function () {
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        manager.update_predecessors = [xsmall_plan_id];
        expect(manager.restorePredecessors).to.eql(manager.update_predecessors);
      });
    });
    describe('#executeActions', function () {
      const rabbit_plan_id = 'b715f834-2048-11e7-a560-080027afc1e6';
      const context = {
        deployment_name: 'my-deployment'
      };
      it('should return empty response if no actions are defined', function () {
        manager = new DirectorManager(catalog.getPlan(rabbit_plan_id));
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql({});
          });
      });
      it('should return empty response if actions are not provided', function () {
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        let temp_actions = manager.service.actions;
        manager.service.actions = '';
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            manager.service.actions = temp_actions;
            expect(actionResponse).to.eql({});
          });
      });
      it('should return correct action response', function () {
        manager = new DirectorManager(catalog.getPlan(xsmall_plan_id));
        let expectResponse = {
          ReserveIps: ['10.244.11.247'],
          Blueprint: {
            precreate_input: {
              deployment_name: 'my-deployment'
            }
          }
        };
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql(expectResponse);
          });
      });
      it('should return not implemented if actions scripts are not provided', function () {
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        let temp_actions = manager.service.actions;
        manager.service.actions = 'MyAction';
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .catch(err => {
            manager.service.actions = temp_actions;
            expect(err).to.have.status(501);
          });
      });
      it('should return timeout error if action scripts exceeds time limit', function () {
        let actionScriptName = 'MyAction_PreCreate';
        let actionFilePath = path.join(__dirname, '../lib/fabrik/actions/sh', `${actionScriptName}`);
        fs.writeFileSync(actionFilePath, 'sleep 0.1', {
          mode: CONST.FILE_PERMISSIONS.RWXR_XR_X
        });
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        let temp_actions = manager.service.actions;
        let temp_deployment_action_timeout = config.deployment_action_timeout;
        config.deployment_action_timeout = 80;
        manager.service.actions = 'MyAction';
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .catch(err => {
            fs.unlinkSync(actionFilePath);
            manager.service.actions = temp_actions;
            config.deployment_action_timeout = temp_deployment_action_timeout;
            expect(err).to.have.status(500);
          });
      });
      it('should return error with error message if action scripts throws an error', function () {
        let actionScriptName = 'MyAction_PreCreate';
        let actionFilePath = path.join(__dirname, '../lib/fabrik/actions/sh', `${actionScriptName}`);
        fs.writeFileSync(actionFilePath, 'echo "Error occured in action script";exit 1', {
          mode: CONST.FILE_PERMISSIONS.RWXR_XR_X
        });
        manager = new DirectorManager(catalog.getPlan(small_plan_id));
        let temp_actions = manager.service.actions;
        manager.service.actions = 'MyAction';
        return manager.executeActions(CONST.SERVICE_LIFE_CYCLE.PRE_CREATE, context)
          .catch(err => {
            fs.unlinkSync(actionFilePath);
            manager.service.actions = temp_actions;
            expect(err.description).to.equal('Error occured in action script\n');
          });
      });
    });
  });
});