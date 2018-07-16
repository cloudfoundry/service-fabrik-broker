'use strict';

const _ = require('lodash');
const CONST = require('../../common/constants');
const config = require('../../common/config');
const Service = require('../../broker/lib/models/Service');

describe('models', () => {
  describe('Service', () => {
    describe('constructor', () => {
      let options = {
        id: 42,
        name: 'sample',
        description: 'sample description',
        bindable: false,
        plans: [{
          name: 'test-pan1',
          manager: {
            name: CONST.INSTANCE_TYPE.DIRECTOR,
            settings: {
              context: {
                agent: {
                  provider: {
                    credhub_key: '/blueprint',
                    credhub_user_name: 'uaa',
                    credhub_pass_word: 'pwd'
                  }
                }
              }
            }
          }
        }, {
          name: 'test-pan1',
          manager: {
            name: CONST.INSTANCE_TYPE.DOCKER
          }
        }]
      };
      let service = new Service(options);
      it('returns an initialized BaseModel object with defaults', () => {
        const credHubProvider = {
          credhub_key: '/blueprint',
          credhub_user_name: 'uaa',
          credhub_pass_word: 'pwd'
        };
        _.assign(credHubProvider,
          _.omit(config.cred_provider, 'credhub_username', 'credhub_user_password'));

        expect(service.id).to.equal(options.id);
        expect(service.name).to.equal(options.name);
        expect(service.description).to.equal(options.description);
        expect(service.bindable).to.equal(options.bindable);
        expect(service.tags).to.eql([]);
        expect(service.plan_updateable).to.equal(true);
        expect(service.plans[0].manager.settings.context.agent.provider).to.eql(credHubProvider);
        expect(service.plans[1].manager).to.eql({
          name: CONST.INSTANCE_TYPE.DOCKER
        });
      });
    });

    describe('toJSON', () => {
      let options = {
        id: 42,
        name: 'sample',
        description: 'sample description',
        bindable: false
      };
      let service = new Service(options);
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