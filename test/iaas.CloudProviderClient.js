'use strict';

const lib = require('../broker/lib');
const pkgcloud = require('pkgcloud');
const CloudProviderClient = lib.iaas.CloudProviderClient;

describe('iaas', function () {
  describe('CloudProviderClient', function () {
    this.slow(200);

    const createClientSpy = sinon.spy(pkgcloud.storage, 'createClient');

    afterEach(function () {
      createClientSpy.reset();
    });

    describe('#deleteSnapshot', function () {
      it('bubbles up the error if cloudprovider throws error', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId',
          region: 'region'
        });
        const errorMessageExpected = 'fake-snap not found';
        const deleteSnapshotStub = sinon.stub(client.blockstorage, 'deleteSnapshot');
        deleteSnapshotStub.withArgs({
          SnapshotId: 'fake-snap'
        }).throws(Error(errorMessageExpected));
        client
          .deleteSnapshot('fake-snap')
          .catch(err => expect(err.message).to.equal(errorMessageExpected));
      });
      it('should throw error for openstack cloudprovider client', function () {
        const client = new CloudProviderClient({
          name: 'os',
          authUrl: 'https://keystone.org:5000/test/v3',
          keystoneAuthVersion: 'v3',
          domainName: 'domain',
          tenantName: 'service-fabrik',
          username: 'user',
          password: 'secret'
        });
        const errorMessageExpected = 'ComputeClient is not supported for openstack';
        client
          .deleteSnapshot('fake-snap')
          .catch(err => err)
          .then(err => {
            expect(err.status).to.equal(501);
            expect(err.message).to.equal(errorMessageExpected);
          });
      });
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

      it('should create an aws client instance with max_retries', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId',
          max_retries: 12
        });
        expect(client.provider).to.equal('amazon');
        expect(createClientSpy)
          .to.be.calledWith({
            provider: 'amazon',
            key: 'key',
            keyId: 'keyId',
            max_retries: 12
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