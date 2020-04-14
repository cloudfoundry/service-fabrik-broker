'use strict';

const Addons = require('../../data-access-layer/bosh/src/manifest/Addons');
const { CONST } = require('@sf/common-utils');
const Networks = require('../../data-access-layer/bosh/src/manifest/Networks');

describe('bosh', () => {
  describe('manifest', () => {
    describe('Addons', () => {
      const networks = new Networks([{
        name: 'network1',
        type: 'manual',
        cloud_properties: {
          name: 'random'
        },
        subnets: [{
          az: 'z1',
          range: '127.0.0.1/26'
        }, {
          az: 'z2',
          range: '127.1.0.1/26'
        },
        {
          az: 'z3',
          range: '127.2.0.1/26'
        }
        ]
      }], 1, {
        size: 1
      });
      const context = {
        networks: networks.all
      };
      describe('#getAll', () => {
        it('returns list of addon jobs that are to be configured for the service', () => {
          let expectedJSON = [{
            name: CONST.ADD_ON_JOBS.IP_TABLES_MANAGER,
            jobs: [{
              name: CONST.ADD_ON_JOBS.IP_TABLES_MANAGER,
              release: CONST.SERVICE_FABRIK_PREFIX,
              properties: {
                allow_ips_list: '127.0.0.2,127.1.0.2,127.2.0.2',
                block_ips_list: '127.0.0.1/26,127.1.0.1/26,127.2.0.1/26',
                enable_connection: false
              }
            }]
          }];
          const addOns = new Addons(context).getAll();
          expect(addOns).to.eql(expectedJSON);
        });
        it('throws error when requesting for an addon job thats not configured', () => {
          const addOns = new Addons(context);
          expect(addOns.getAddOn.bind(addOns, 'iptables')).to.throw('Invalid add-on job type. iptables does not exist');
        });
      });
    });
  });
});
