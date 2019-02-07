'use strict';

const proxyquire = require('proxyquire');
const errors = require('../../common/errors');
const ServiceNotFound = errors.ServiceNotFound;
const ServicePlanNotFound = errors.ServicePlanNotFound;

let plan1 = {
  id: 1,
  sku_name: 'plan1_sku',
  name: 'plan1'
};
let plan2 = {
  id: 2,
  sku_name: 'plan2_sku',
  name: 'plan2'
};
let service1 = {
  id: 1,
  name: 'service1',
  plans: [plan1, plan2]
};

const catalog = proxyquire('../../common/models/catalog', {
  '../config': {
    services: [service1]
  },
  './Service': class {
    constructor(service) {
      this.id = service.id;
      this.name = service.name;
      this.plans = service.plans;
    }
  }
});

describe('models', () => {
  describe('catalog', () => {
    describe('#getPlan', () => {
      it('returns a service plan instance', () => {
        expect(catalog.getPlan(2)).to.eql(plan2);
      });

      it('returns a ServicePlanNotFound error', () => {
        expect(catalog.getPlan.bind(catalog, 3)).to.throw(ServicePlanNotFound);
      });
    });

    describe('#getService', () => {
      it('returns a service instance', () => {
        expect(catalog.getService(1)).to.eql(service1);
      });

      it('returns a ServiceNotFound error', () => {
        expect(catalog.getService.bind(catalog, 2)).to.throw(ServiceNotFound);
      });
    });

    describe('#getServiceName', () => {
      it('returns a service name', () => {
        expect(catalog.getServiceName(1)).to.eql('service1');
      });

      it('returns a ServiceNotFound error', () => {
        expect(catalog.getServiceName.bind(catalog, 2)).to.throw(ServiceNotFound);
      });
    });

    describe('#toJSON', () => {
      it('returns a JSON object', () => {
        expect(catalog.toJSON()).to.eql({
          services: [service1]
        });
      });
    });

    describe('#getPlanSKUFromPlanGUID', () => {
      it('returns the sku', () => {
        expect(catalog.getPlanSKUFromPlanGUID(service1.id, plan1.id)).to.eql(plan1.sku_name);
      });
    });
  });
});