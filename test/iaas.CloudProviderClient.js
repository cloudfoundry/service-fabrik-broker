'use strict';

const lib = require('../lib');
const pkgcloud = require('pkgcloud');
const CloudProviderClient = lib.iaas.CloudProviderClient;

describe('iaas', function () {
  describe('CloudProviderClient', function () {
    this.slow(200);

    const createClientSpy = sinon.spy(pkgcloud.storage, 'createClient');

    afterEach(function () {
      createClientSpy.reset();
    });

    describe('#constructor', function () {

      it('should create an aws client instance', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId'
        });
        expect(client.provider).to.equal('amazon');
        expect(createClientSpy)
          .to.be.calledWith({
            provider: 'amazon',
            key: 'key',
            keyId: 'keyId'
          });
      });

      it('should create an openstack client instance', function () {
        const client = new CloudProviderClient({
          name: 'os',
          authUrl: 'https://keystone.org:5000/test/v3',
          keystoneAuthVersion: 'v3',
          domainName: 'domain',
          tenantName: 'service-fabrik',
          username: 'user',
          password: 'secret'
        });
        expect(client.provider).to.equal('openstack');
        expect(createClientSpy)
          .to.be.calledWithMatch({
            provider: 'openstack',
            authUrl: 'https://keystone.org:5000/test',
            keystoneAuthVersion: 'v3',
            domainName: 'domain',
            tenantName: 'service-fabrik',
            username: 'user',
            password: 'secret'
          });
      });
    });
  });
});