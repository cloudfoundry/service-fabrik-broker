'use strict';

const _ = require('lodash');
const Header = require('../lib/bosh/manifest/Header');

describe('bosh', () => {
  describe('manifest', () => {
    describe('Header', () => {
      let header = new Header({
        name: 1,
        director_uuid: 2,
        releases: 3,
        compilation: 4,
        disk_pools: [{
          name: 'foo'
        }, {
          name: 'bar'
        }],
        resource_pools: [{
          name: 'foobar'
        }, {
          name: 'barfoo_abc'
        }],
        networks: 7
      });

      let header2 = new Header({
        name: 1,
        director_uuid: 2,
        compilation: 4,
        disk_pools: [{
          name: 'foo'
        }, {
          name: 'bar'
        }],
        resource_pools: [{
          name: 'foobar'
        }, {
          name: 'barfoo_abc'
        }],
        networks: 7
      });

      describe('#select', () => {
        it('returns a string (options contain disk_pools)', () => {
          let options = {
            disk_pools: ['foo', 'bar']
          };

          expect(header.select(options)).to.eql(header);
        });

        it('returns a string (options do not contain disk_pools)', () => {
          let options = {};

          expect(header.select(options)).to.eql(_.merge(header2, {
            releases: 3
          }));
        });
      });

      describe('#toString', () => {
        it('returns a YAML object as string', () => {
          let expectedString = 'name: 1\nreleases: 3\n';

          expect(header.toString()).to.eql(expectedString);
        });
      });
    });
  });
});