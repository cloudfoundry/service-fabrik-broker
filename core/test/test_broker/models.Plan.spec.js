'use strict';

const _ = require('lodash');
const Plan = require('../../common/models').Plan;

describe('models', function () {
  describe('Plan', function () {
    const service = {};
    const id = 'id';
    const name = 'name';
    const metadata = {
      foo: 'bar'
    };
    const supported_features = ['credentials'];
    const update_predecessors = ['1234'];
    const plan = new Plan(service, {
      id: id,
      name: name,
      metadata: metadata,
      manager: {
        resource_mappings: {
          bind: {
            resource_group: 'bind',
            resource_type: 'directorbind'
          },
          restore: {
            resource_group: 'restore',
            resource_type: 'defaultrestores'
          }
        },
        settings: {
          update_predecessors: update_predecessors,
          agent: {
            supported_features: supported_features
          }
        }
      },
      free: true
    });

    describe('#create', function () {
      it('should ensure that plan has an id', function () {
        expect(plan).to.have.property('id', id);
      });
    });
    describe('#stemcell', function () {
      it('ensures default stemcell is correct', function () {
        expect(plan.stemcell).to.eql({
          alias: 'ubuntu-trusty',
          name: 'bosh-warden-boshlite-ubuntu-trusty-go_agent',
          version: 'latest'
        });
      });
    });
    describe('#releases', function () {
      it('ensures default release is correct', function () {
        expect(plan.releases).to.eql([]);
      });
    });
    describe('#bind', function () {
      it('ensures bind resourcegroup is correct', function () {
        expect(plan.bindResourceGroup).to.eql('bind');
      });
      it('ensures bind resourcetype is correct', function () {
        expect(plan.bindResourceType).to.eql('directorbind');
      });
    });
    describe('#restoreResourceMappings', function() {
      it('ensures restore resourcegroup is correct', function() {
        expect(plan.restoreResourceGroup).to.eql('restore');
      });
      it('ensures restore resourcetype is correct', function() {
        expect(plan.restoreResourceType).to.eql('defaultrestores');
      });
    });
    describe('#toJSON', function () {
      it('should return the JSON representation of the plan', function () {
        expect(plan.toJSON()).to.eql({
          id: id,
          name: name,
          metadata: _.assign({
            update_predecessors: update_predecessors,
            supported_features: supported_features
          }, metadata),
          free: true
        });
      });
    });
  });
});