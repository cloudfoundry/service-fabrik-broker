'use strict';

const lib = require('../lib');
const catalog = lib.models.catalog;
const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const errors = require('../lib/errors');
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;

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
    },
    getDeploymentVms: function () {
      return Promise.resolve([{
        agent_id: 'fdbb2b4c-cfc8-49aa-8d5e-1994f8fe9a1c',
        cid: '7cac3814-644c-4b83-408d-f42cd059d25f',
        job: 'blueprint',
        index: 0,
        id: '942963f9-7a01-45ef-b92d-16a02d3d92a1',
        az: null,
        ips: [
          '10.244.0.9'
        ],
        vm_created_at: '2017-12-11T02:52:25Z'
      }]);
    }
  }
};

var DirectorManager = proxyquire('../lib/fabrik/DirectorManager', {
  '../bosh': boshStub,
});

describe('fabrik', function () {
  describe('DirectorManager', function () {
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    let manager;
    before(function () {
      manager = new DirectorManager(catalog.getPlan(plan_id));
    });

    describe('#getDeploymentName', function () {
      it('should append guid to defined prefix in deployment name', function () {
        expect(manager.plan.id).to.eql(plan_id);
        expect(manager.getDeploymentName(used_guid)).to.eql(`service-fabrik-${used_guid}`);
        manager.aquireNetworkSegmentIndex(used_guid)
          .catch(err => expect(err).to.be.instanceof(ServiceInstanceAlreadyExists));
        manager.aquireNetworkSegmentIndex(free_guid).then(index => expect(index).to.eql(2));
      });
    });
    describe.skip('#findNetworkSegmentIndex', function () {
      it('should append guid and network segment index to deployment name', function () {
        manager.findNetworkSegmentIndex(used_guid).then(res => expect(res).to.eql(21));
      });
    });
    describe('#getDeploymentIps', function () {
      it('should return the IPs in the deployment', function () {
        manager.getDeploymentIps(`service-fabrik-${used_guid}`)
          .then(ipList => expect(ipList).to.eql(['10.244.0.9']));
      });
    });

  });
});