'use strict';

const _ = require('lodash');
const Network = require('../broker/lib/bosh/manifest/Network');

describe('bosh', () => {
  describe('manifest', () => {
    describe('Network', () => {
      describe('#toJSON', () => {
        it('returns a JSON object', () => {
          let network = new Network({
            name: 'default',
            subnet_name: 'default_z1',
            type: 'manual',
            cloud_properties: {
              name: 'random'
            }
          });

          let expectedJSON = _.omit(network, ['cloud_properties', 'subnet_name']);

          expect(network.toJSON()).to.eql(expectedJSON);
        });
      });

      describe('#create', () => {
        it('returns a dynamic network object (cloud_properties not set)', () => {
          let expectedJSON = {
            name: 'default',
            type: 'dynamic'
          };

          expect(Network.create(expectedJSON).toJSON()).to.eql(expectedJSON);
        });

        it('returns a dynamic network object (cloud_properties set)', () => {
          let expectedJSON = {
            name: 'default',
            type: 'dynamic',
            cloud_properties: {}
          };

          expect(Network.create(expectedJSON).toJSON()).to.eql(expectedJSON);
        });

        it('returns a manual network object (offset and size not set)', () => {
          let network = Network.create({
            name: 'default',
            type: 'manual',
            range: '127.0.0.1/25',
            index: 42
          });

          expect(network.cidr.subnet.broadcastAddress).to.eql('127.0.0.127');
          expect(network.cidr.ip).to.eql('127.0.0.0');
          expect(network.cidr.gateway).to.eql('127.0.0.1');
          expect(network.cidr.length).to.eql(128);
          expect(network.cidr.nth(22)).to.eql('127.0.0.22');
          expect(network.cidr.range(8, 10)).to.eql(['127.0.0.8', '127.0.0.9', '127.0.0.10']);
          expect(network.cidr.toString()).to.eql('127.0.0.0/25');
          expect(network.reserved).to.eql(['127.0.0.2 - 127.0.0.85', '127.0.0.88 - 127.0.0.126']);
        });

        it('returns a manual network object (offset and size set)', () => {
          let expectedObject = {
            name: 'default',
            type: 'manual',
            range: '127.0.0.1/26',
            index: 42,
            offset: 13,
            size: 0.001,
            dns: 'foo',
            cloud_properties: 'bar'
          };
          let network = Network.create(expectedObject);

          expect(network.cidr.subnet.broadcastAddress).to.eql('127.0.0.63');
          expect(network.cidr.ip).to.eql('127.0.0.0');
          expect(network.cidr.gateway).to.eql('127.0.0.1');
          expect(network.cidr.length).to.eql(64);
          expect(network.cidr.nth(22)).to.eql('127.0.0.22');
          expect(network.cidr.range(8, 10)).to.eql(['127.0.0.8', '127.0.0.9', '127.0.0.10']);
          expect(network.cidr.toString()).to.eql('127.0.0.0/26');
          expect(network.reserved).to.eql(['127.0.0.0 - 127.0.0.62']);

          expect(network.toJSON()).to.eql(_.omit(_.merge(expectedObject, {
            subnets: [{
              cloud_properties: 'bar',
              dns: 'foo',
              gateway: '127.0.0.1',
              range: '127.0.0.1/26',
              reserved: ['127.0.0.0 - 127.0.0.62'],
              static: []
            }]
          }), ['index', 'offset', 'range', 'size', 'dns', 'cloud_properties']));
        });

        it('throws an error', () => {
          expect(Network.create.bind(Network, {
            name: 'default',
            type: 'invalid'
          })).to.throw('Invalid network type');
        });
      });
    });
  });
});