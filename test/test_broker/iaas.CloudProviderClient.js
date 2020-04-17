'use strict';

const pkgcloud = require('pkgcloud');
const { CloudProviderClient } = require('@sf/iaas');

describe('iaas', function () {
  describe('CloudProviderClient', function () {
    this.slow(200);

    const createClientSpy = sinon.spy(pkgcloud.storage, 'createClient');

    afterEach(function () {
      createClientSpy.resetHistory();
    });

    describe('#createDiskFromSnapshot', function () {
      const diskId = 'sample-disk';
      const snapshotId = 'sample-snapshot';
      const volType = 'gp2';
      const zone = 'zone';
      const response = {
        VolumeId: diskId,
        Size: '4',
        AvailabilityZone: 'zone',
        VolumeType: 'type',
        Tags: [{
          Key: 'k1',
          Value: 'v1'
        }, {
          Key: 'k2',
          Value: 'v2'
        }]
      };
      const waitForResponse = {
        Volumes: [response]
      };
      it('should create disk from snapshot for aws', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId',
          region: 'region'
        });
        const createVolStub = sinon.stub(client.blockstorage, 'createVolume');
        createVolStub.withArgs({
          AvailabilityZone: zone,
          SnapshotId: snapshotId,
          VolumeType: volType,
          TagSpecifications: [{
            ResourceType: 'volume',
            Tags: [{
              Key: 'customkey',
              Value: 'customvalue'
            }, {
              Key: 'createdBy',
              Value: 'service-fabrik'
            }]
          }]
        }).returns({
          promise: () => Promise.resolve(response)
        });
        const waitForStub = sinon.stub(client.blockstorage, 'waitFor');
        waitForStub.withArgs('volumeAvailable', {
          VolumeIds: [diskId]
        })
          .returns({
            promise: () => Promise.resolve(waitForResponse)
          });
        return client
          .createDiskFromSnapshot(snapshotId, zone, {
            volumeType: 'gp2',
            tags: {
              customkey: 'customvalue'
            }
          })
          .then(disk => {
            expect(disk.volumeId).to.eql(diskId);
            expect(disk.size).to.eql('4');
            expect(disk.zone).to.eql('zone');
            expect(disk.type).to.eql('type');
            expect(disk.extra).to.deep.equal({
              type: 'type',
              tags: {
                k1: 'v1',
                k2: 'v2'
              }
            });
          });
      });
      it('should fail on creating disk from snapshot for aws', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId',
          region: 'region'
        });
        const createVolStub = sinon.stub(client.blockstorage, 'createVolume');
        createVolStub.withArgs({
          AvailabilityZone: zone,
          SnapshotId: snapshotId,
          VolumeType: volType,
          TagSpecifications: [{
            ResourceType: 'volume',
            Tags: [{
              Key: 'customkey',
              Value: 'customvalue'
            }, {
              Key: 'createdBy',
              Value: 'service-fabrik'
            }]
          }]
        }).returns({
          promise: () => Promise.reject(new Error('diskerror'))
        });
        return client
          .createDiskFromSnapshot(snapshotId, zone, {
            volumeType: 'gp2',
            tags: {
              customkey: 'customvalue'
            }
          })
          .catch(err => {
            expect(err.message).to.eql('diskerror');
          });
      });
      it('should fail on waiting for disk from snapshot for aws', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId',
          region: 'region'
        });
        const createVolStub = sinon.stub(client.blockstorage, 'createVolume');
        createVolStub.withArgs({
          AvailabilityZone: zone,
          SnapshotId: snapshotId,
          VolumeType: volType,
          TagSpecifications: [{
            ResourceType: 'volume',
            Tags: [{
              Key: 'customkey',
              Value: 'customvalue'
            }, {
              Key: 'createdBy',
              Value: 'service-fabrik'
            }]
          }]
        }).returns({
          promise: () => Promise.resolve(response)
        });
        const waitForStub = sinon.stub(client.blockstorage, 'waitFor');
        waitForStub.withArgs('volumeAvailable', {
          VolumeIds: [diskId]
        })
          .returns({
            promise: () => Promise.reject(new Error('diskwaiterror'))
          });
        return client
          .createDiskFromSnapshot(snapshotId, zone, {
            volumeType: 'gp2',
            tags: {
              customkey: 'customvalue'
            }
          })
          .catch(err => {
            expect(err.message).to.eql('diskwaiterror');
          });
      });
    });

    describe('#getDiskMetadata', function () {
      const diskId = 'sample-disk';
      const response = {
        Volumes: [{
          VolumeId: diskId,
          Size: '4',
          AvailabilityZone: 'zone',
          VolumeType: 'type',
          Tags: [{
            Key: 'k1',
            Value: 'v1'
          }, {
            Key: 'k2',
            Value: 'v2'
          }]
        }]
      };
      it('should fetch disk metadata for aws', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId',
          region: 'region'
        });
        const describeVolumesStub = sinon.stub(client.blockstorage, 'describeVolumes');
        describeVolumesStub.withArgs({
          VolumeIds: [diskId]
        }).returns({
          promise: () => Promise.resolve(response)
        });
        return client
          .getDiskMetadata(diskId)
          .then(disk => {
            expect(disk.volumeId).to.eql(diskId);
            expect(disk.size).to.eql('4');
            expect(disk.zone).to.eql('zone');
            expect(disk.type).to.eql('type');
            expect(disk.extra).to.deep.equal({
              type: 'type',
              tags: {
                k1: 'v1',
                k2: 'v2'
              }
            });
          });
      });

      it('should throw error while fetching disk metadata for aws', function () {
        const client = new CloudProviderClient({
          name: 'aws',
          key: 'key',
          keyId: 'keyId',
          region: 'region'
        });
        const describeVolumesStub = sinon.stub(client.blockstorage, 'describeVolumes');
        describeVolumesStub.withArgs({
          VolumeIds: [diskId]
        }).returns({
          promise: () => Promise.reject(new Error('diskerror'))
        });
        return client
          .getDiskMetadata(diskId)
          .catch(err => {
            expect(err.message).to.eql('diskerror');
          });
      });
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
