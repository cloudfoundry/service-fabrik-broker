'use strict';

const Header = require('../lib/bosh/manifest/Header');

describe('bosh', () => {
  describe('manifest', () => {
    describe('Header', () => {
      let header = new Header({
        name: 1,
        releases: [3],
        stemcells: [{
          alias: 'ubuntu-trusty',
          name: 'bosh-openstack-kvm-ubuntu-trusty-go_agent',
          version: 'latest'
        }],
        tags: {
          space_guid: '1234',
          organization_guid: '4567'
        },
        release_name: 'service-fabrik',
        release_version: 'latest'
      });

      describe('#toString', () => {
        it('returns a YAML object as string', () => {
          let expectedString = 'name: 1\nreleases:\n  - 3\n  - name: service-fabrik\n    version: latest\nstemcells:\n  - alias: ubuntu-trusty\n    name: bosh-openstack-kvm-ubuntu-trusty-go_agent\n    version: latest\ntags:\n  space_guid: \'1234\'\n  organization_guid: \'4567\'\n';

          expect(header.toString()).to.eql(expectedString);
        });
      });
    });
  });
});