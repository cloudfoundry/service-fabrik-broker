'use strict';

const _ = require('lodash');
const lib = require('../../broker/lib');
const Plan = lib.models.Plan;

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