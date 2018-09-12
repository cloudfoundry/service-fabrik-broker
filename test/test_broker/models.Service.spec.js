'use strict';

const Service = require('../../common/models/Service');

describe('models', () => {
  describe('Service', () => {
    let options = {
      id: 42,
      name: 'sample',
      description: 'sample description',
      bindable: false
    };
    let service = new Service(options);
    describe('constructor', () => {
      it('returns an initialized BaseModel object with defaults', () => {

        expect(service.id).to.equal(options.id);
        expect(service.name).to.equal(options.name);
        expect(service.description).to.equal(options.description);
        expect(service.bindable).to.equal(options.bindable);
        expect(service.tags).to.eql([]);
        expect(service.plan_updateable).to.equal(true);
      });
    });

    describe('toJSON', () => {
      it('returns a JSON object', () => {
        expect(service.toJSON()).to.eql({
          id: options.id,
          name: options.name,
          description: options.description,
          bindable: options.bindable,
          tags: [],
          subnet: null,
          metadata: null,
          requires: [],
          plan_updateable: true,
          dashboard_client: {},
          plans: [],
          application_access_ports: null
        });
      });
    });
  });
});