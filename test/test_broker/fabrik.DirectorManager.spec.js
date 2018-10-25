'use strict';

const _ = require('lodash');
const yaml = require('js-yaml');
const catalog = require('../../common/models').catalog;
const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const CONST = require('../../common/constants');

var used_guid = '4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9';
var deployment_name = `service-fabrik-0021-${used_guid}`;
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
      return Promise.resolve([deployment_name]);
    },
    getDeploymentNameForInstanceId: function () {
      return Promise.resolve([deployment_name]);
    }
  }
};

describe('fabrik', function () {
  describe('DirectorManager- without rate limits', function () {
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const xsmall_plan_id = plan_id;
    const small_plan_id = 'bc158c9a-7934-401e-94ab-057082a5073e';
    let return_value;
    let manager;
    var DirectorManager = proxyquire('../../broker/lib/fabrik/DirectorManager', {
      '../../../data-access-layer/bosh': boshStub,
    });

    before(function () {
      manager = new DirectorManager(catalog.getPlan(plan_id));
    });
    afterEach(function () {
      mocks.reset();
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

    describe('#configureAddOns', function () {
      it('should update manifest with addons', function () {
        const plan = _.cloneDeep(catalog.getPlan(plan_id));
        const directorManager = new DirectorManager(plan);
        const updatedTemplate = directorManager.template + '\n' +
          'addons: \n' +
          '  - name: service-addon \n' +
          '    jobs: \n' +
          '    - name: service-addon \n' +
          '      release: service-release';
        directorManager.plan.manager.settings.template = Buffer.from(updatedTemplate).toString('base64');
        expect(directorManager.plan.id).to.eql(plan_id);
        expect(directorManager.getDeploymentName(used_guid, '90')).to.eql(`service-fabrik-90-${used_guid}`);
        const manifest = yaml.safeLoad(directorManager.generateManifest(`service-fabrik-90-${used_guid}`, {}));
        expect(manifest.addons.length).to.equal(2);
        expect(manifest.releases.length).to.equal(2);
      });
      it('should not update manifest with addons with parameter skip_addons set to true', function () {
        const directorManager = new DirectorManager(catalog.getPlan(plan_id));
        expect(directorManager.plan.id).to.eql(plan_id);
        expect(directorManager.getDeploymentName(used_guid, '90')).to.eql(`service-fabrik-90-${used_guid}`);
        const manifest = yaml.safeLoad(directorManager.generateManifest(`service-fabrik-90-${used_guid}`, {
          skip_addons: true
        }));
        expect(manifest.addons).to.equal(undefined);
        expect(manifest.releases.length).to.equal(1);
      });
    });
  });
});