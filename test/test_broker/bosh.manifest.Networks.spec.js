'use strict';

const Networks = require('../../broker/lib/bosh/manifest/Networks');

describe('bosh', () => {
  describe('manifest', () => {
    describe('Networks', () => {
      let networks = new Networks([{
        name: 'network1',
        type: 'dynamic',
        cloud_properties: {
          name: 'random'
        },
        subnets: [{
          az: 'z1',
          gateway: '127.0.0.1',
          range: '127.0.0.1/26',
          reserved: [
            '127.0.0.2 - 127.0.7.242'
          ],
          static: [
            '127.0.7.243'
          ]
        }]
      }, {
        name: 'network2',
        type: 'manual',
        range: '127.0.0.1/26',
        index: 42,
        offset: 13,
        size: 37
      }], 42, {});

      let networks2 = new Networks();

      describe('#manual', () => {
        it('returns one manual network object', () => {
          expect(networks.manual).to.have.length(1);
          expect(networks.manual[0].name).to.eql('network2');
          expect(networks2.manual).to.have.length(0);
        });
      });

      describe('#dynamic', () => {
        it('returns one dynamic network object', () => {
          expect(networks.dynamic).to.have.length(1);
          expect(networks.dynamic[0].name).to.eql('network1');
          expect(networks.dynamic[0].subnet_name).to.eql('network1_z1');
        });
      });

      describe('#slice', () => {
        it('returns one element', () => {
          expect(networks.slice(0, 1)).to.have.length(1);
        });
      });

      describe('#each', () => {
        it('returns one element', () => {
          let names = [];

          networks.each((net) => {
            names.push(net.name);
          });

          expect(names).to.contain('network2');
        });
      });
    });
  });
});