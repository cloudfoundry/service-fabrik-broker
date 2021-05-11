'use strict';

const { AwsClient } = require('@sf/iaas');

describe('iaas', function () {
  describe('AwsClient', function () {
    this.slow(200);

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
        const client = new AwsClient({
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
        const client = new AwsClient({
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
        const client = new AwsClient({
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
        const client = new AwsClient({
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
        const client = new AwsClient({
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
      it('bubbles up the error if aws throws error', function () {
        const client = new AwsClient({
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
    });

    describe('#ValidateParams', function () {

      it('should throw error if config is not passed', function () {
        expect(() => AwsClient.validateParams(null)).to.throw();
      });

      it('should throw error if key is not provided in config', function () {
        let config = {
          keyId: 'keyId',
          region: 'eu-central-1'
        };
        expect(() => AwsClient.validateParams(config)).to.throw();
      });

      it('should throw error if keyId is not provided in config', function () {
        let config = {
          key: 'key',
          region: 'eu-central-1'
        };
        expect(() => AwsClient.validateParams(config)).to.throw();
      });

      it('should throw error if region is not provided in config', function () {
        let config = {
          key: 'key',
          keyId: 'keyId'
        };
        expect(() => AwsClient.validateParams(config)).to.throw();
      });

      it('should return true if key, keyId and region are provided in config', function () {
        let config = {
          key: 'key',
          keyId: 'keyId',
          region: 'eu-central-1'
        };
        expect(AwsClient.validateParams(config)).to.equal(true);
      });

      
    });
  });
});
