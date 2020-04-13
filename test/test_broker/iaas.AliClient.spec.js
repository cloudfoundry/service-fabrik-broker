'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    NotFound,
    Unauthorized,
    Forbidden,
    UnprocessableEntity,
    Timeout
  }
} = require('@sf/common-utils');
const { AliClient } = require('@sf/iaas');
const AliStorage = require('ali-oss');
const AliCompute = require('@alicloud/pop-core');

const config = {
  backup: {
    retention_period_in_days: 14,
    max_num_on_demand_backup: 2,
    status_check_every: 120000, // (ms) Check the status of backup once every 2 mins
    backup_restore_status_poller_timeout: 86400000, // (ms) Deployment backup/restore must finish within this timeout time (24 hrs)
    backup_restore_status_check_every: 120000, // (ms) Check the status of deployment backup/restore once every 2 mins
    abort_time_out: 300000, // (ms) Timeout time for abort of backup to complete
    provider: {
      keyId: 'key-id',
      container: 'sample-container',
      endpoint: 'https://sample-endpoint',
      name: 'ali',
      region: 'region-name',
      key: 'secret-key'
    }
  }
};
const settings = config.backup.provider;
const bucketMetadataResponse = {
  buckets: [{
    name: 'sample-container',
    id: 'sample-container',
    timeCreated: '2017-12-24T10:23:50.348Z',
    updated: '2017-12-24T10:23:50.348Z',
    location: 'region-name'
  }]
};
const bucketMetadataNotFoundResponse = {
  buckets: null
};
const bucketMetadataMultipleResponse = {
  buckets: [{
    name: 'sample-container',
    id: 'sample-container',
    timeCreated: '2017-12-24T10:23:50.348Z',
    updated: '2017-12-24T10:23:50.348Z',
    location: 'region-name'
  },
  {
    name: 'sample-container2',
    id: 'sample-container2',
    timeCreated: '2017-12-24T10:23:50.348Z',
    updated: '2017-12-24T10:23:50.348Z',
    location: 'region-name'
  }
  ]
};
const listFilesResponse = {
  objects:
    [{
      name: 'blob1.txt',
      lastModified: '2018-03-08T14:15:49.655Z'
    },
    {
      name: 'blob2.txt',
      lastModified: '2018-03-08T14:15:49.655Z'
    }]
};
const deleteFileSuccessResponse = {
  undefined
};

const validBlobName = 'blob1.txt';
const invalidBlobName = 'invalid_blob';
const invalidBlobName2 = 'invalid_blob2';
const notFoundBlobName = 'notfound_blob';
const jsonContent = {
  content: '{"data": "This is a sample content"}'
};
const invalidJsonContent = {
  content: 'invalid json content'
};
const wrongContainer = 'wrong-container';
const bucketStub = function () {
  return Promise.resolve(bucketMetadataResponse);
};
const incorrectBucketStub = function () {
  return Promise.resolve(bucketMetadataNotFoundResponse);
};
const incorrectBucketStub2 = function () {
  return Promise.resolve(bucketMetadataMultipleResponse);
};
const listFilesStub = {
  list: () => {
    return Promise.resolve(listFilesResponse);
  },
  get: file => {
    if (file === validBlobName) {
      return Promise.resolve(jsonContent);
    } else if (file === invalidBlobName) {
      return Promise.resolve(invalidJsonContent);
    } else if (file === notFoundBlobName) {
      return Promise.reject(new NotFound(`Object '${file}' not found`));
    }

  },
  put: () => {
    return Promise.resolve(jsonContent);
  },
  delete: file => {
    if (file === validBlobName) {
      return Promise.resolve(deleteFileSuccessResponse);
    } else if (file === invalidBlobName) {
      return Promise.reject(new Unauthorized(`Authorization at ali cloud storage provider failed while deleting blob ${file} in container ${settings.container}`));
    } else if (file === invalidBlobName2) {
      return Promise.reject(new Forbidden(`Authentication at ali cloud storage provider failed while deleting blob ${file} in container ${settings.container}`));
    } else if (file === notFoundBlobName) {
      return Promise.reject(new NotFound(`Object '${file}' not found while deleting in container ${settings.container}`));
    }
  }
};

const diskName = 'disk-sample';
const diskDetailsResponse = {
  Disks: {
    Disk: [{
      DiskId: diskName,
      Size: 20,
      ZoneId: 'zone',
      Category: 'cloud_ssd',
      Status: 'Available'
    }]
  }
};

const getDiskStub = function () {
  return Promise.resolve(diskDetailsResponse);
};
const getDiskFailStub = function () {
  return Promise.reject(new Error('diskFailed'));
};
const getDiskTimeoutStub = function () {
  const timeoutResp = _.clone(diskDetailsResponse);
  timeoutResp.Disks.Disk[0].Status = 'Creating';
  return Promise.resolve(timeoutResp);
};

const createDiskStub = function () {
  return Promise.resolve({
    DiskId: diskName
  });
};

const deleteSnapshotStub = function () {
  return Promise.resolve({});
};

const deleteSnapshotFailStub = function () {
  return Promise.reject(new Error('snapshotDeletionFailed'));
};


describe('iaas', function () {
  describe('AliClient', function () {
    describe('#AliStorage', function () {
      it('should form an object with correct credentials', function () {
        const responseAliStorageObject = AliClient.createStorageClient(settings);
        expect(responseAliStorageObject.options.accessKeyId).to.equal(settings.keyId);
        expect(responseAliStorageObject.options.accessKeySecret).to.equal(settings.key);
        expect(responseAliStorageObject.options.region).to.equal(settings.region);
        expect(responseAliStorageObject.options.endpoint.href).to.equal(settings.endpoint + '/');
        expect(responseAliStorageObject.options.endpoint.hostname).to.equal(_.split(settings.endpoint, '//')[1]);
        expect(responseAliStorageObject.options.endpoint.protocol).to.equal(_.split(settings.endpoint, '//')[0]);
      });
    });

    describe('#AliCompute', function () {
      it('should form an compute object with correct credentials', function () {
        const responseAliComputeObject = AliClient.createComputeClient(settings);
        expect(responseAliComputeObject.accessKeyId).to.equal(settings.keyId);
        expect(responseAliComputeObject.accessKeySecret).to.equal(settings.key);
        expect(responseAliComputeObject.apiVersion).to.equal(CONST.ALI_CLIENT.ECS.API_VERSION);
        expect(responseAliComputeObject.endpoint).to.equal('https://ecs.aliyuncs.com');
      });
    });

    describe('#BucketOperations', function () {
      let sandbox, client;
      beforeEach(function () {
        sandbox = sinon.createSandbox();
        client = new AliClient(settings);
        sandbox.stub(AliStorage.prototype, 'listBuckets').withArgs({ prefix: settings.container }).callsFake(bucketStub);
        sandbox.stub(AliStorage.prototype, 'useBucket').withArgs(settings.container).returns(listFilesStub);
      });
      afterEach(function () {
        sandbox.restore();
      });

      it('container properties should be retrived successfully', function () {
        return client.getContainer()
          .then(result => {
            expect(result[0].name).to.equal(settings.container);
            expect(result[0].id).to.equal(settings.container);
            expect(result[0].location).to.equal(settings.region);
          })
          .catch(err => {
            throw new Error('expected container properties to be retrived successfully');
          });
      });

      it('getting container properties should fail with Not Found error', function () {
        sandbox.restore();
        sandbox.stub(AliStorage.prototype, 'useBucket').withArgs(settings.container).returns(listFilesStub);
        sandbox.stub(AliStorage.prototype, 'listBuckets').withArgs({ prefix: settings.container }).callsFake(incorrectBucketStub);
        return client.getContainer()
          .then(() => {
            throw new Error('The get container call should fails');
          })
          .catch(err => {
            expect(err).to.be.an.instanceof(NotFound);
          });
      });

      it('getting container properties should fail with multiple buckets error', function () {
        sandbox.restore();
        sandbox.stub(AliStorage.prototype, 'useBucket').withArgs(settings.container).returns(listFilesStub);
        sandbox.stub(AliStorage.prototype, 'listBuckets').withArgs({ prefix: settings.container }).callsFake(incorrectBucketStub2);
        return client.getContainer()
          .then(() => {
            logger.error('The get container call should fails');
            throw new Error('The get container call should fails');
          })
          .catch(err => {
            expect(err.message).to.equal(`More than 1 Buckets with prefix ${settings.container} exists`);
          });
      });

      it('list of files/blobs should be returned', function () {
        const options = {
          prefix: 'blob'
        };
        const expectedResponses = [{
          name: 'blob1.txt',
          lastModified: '2018-03-08T14:15:49.655Z'
        },
        {
          name: 'blob2.txt',
          lastModified: '2018-03-08T14:15:49.655Z'
        }
        ];
        return client.list(options)
          .then(results => {
            expect(results).to.be.an('array');
            expect(results).to.have.lengthOf(2);
            expect(results[0].name).to.equal(expectedResponses[0].name);
            expect(results[0].lastModified).to.equal(expectedResponses[0].lastModified);
            expect(results[1].name).to.equal(expectedResponses[1].name);
            expect(results[1].lastModified).to.equal(expectedResponses[1].lastModified);
          })
          .catch(err => {
            logger.error(err);
            throw new Error('expected list of files/blobs to be returned successfully');
          });
      });
      it('file/blob deletion should be successful', function () {
        return client.remove(validBlobName)
          .then(result => expect(result).to.be.undefined)
          .catch(err => {
            logger.error(err);
            throw new Error('expected file/blob deletion to be successful');
          });
      });
      it('file/blob deletion should fail with Unauthorized error', function () {
        return client.remove(invalidBlobName)
          .then(() => {
            logger.error('file/blob deletion should fail');
            throw new Error('expected file/blob deletion to fail');
          })
          .catch(err => {
            expect(err).to.be.an.instanceof(Unauthorized);
            expect(err.message).to.eql(`Authorization at ali cloud storage provider failed while deleting blob ${invalidBlobName} in container ${settings.container}`);
          });
      });
      it('file/blob deletion should fail with Forbidden error', function () {
        return client.remove(invalidBlobName2)
          .then(() => {
            logger.error('file/blob deletion should fail');
            throw new Error('expected file/blob deletion to fail');
          })
          .catch(err => {
            expect(err).to.be.an.instanceof(Forbidden);
            expect(err.message).to.eql(`Authentication at ali cloud storage provider failed while deleting blob ${invalidBlobName2} in container ${settings.container}`);
          });
      });
      it('file/blob deletion should fail with NotFound error', function () {
        return client.remove(notFoundBlobName)
          .then(() => {
            logger.error('file/blob deletion should fail');
            throw new Error('expected file/blob deletion to fail');
          })
          .catch(err => {
            expect(err).to.be.an.instanceof(NotFound);
            expect(err.message).to.eql(`Object '${notFoundBlobName}' not found while deleting in container ${settings.container}`);
          });
      });
      it('file/blob download should be successful', function () {
        return client.downloadJson(validBlobName)
          .then(response => expect(response).to.eql(JSON.parse(jsonContent.content)))
          .catch(() => {
            throw new Error('expected download to be successful');
          });
      });
      it('file/blob download should fail with Unprocessable Entity error', function () {
        return client.downloadJson(invalidBlobName)
          .then(() => {
            logger.error('file/blob download should fail');
            throw new Error('expected file/blob download to fail');
          })
          .catch(err => {
            expect(err).to.be.an.instanceof(UnprocessableEntity);
            expect(err.message).to.eql(`Object '${invalidBlobName}' data unprocessable`);
          });
      });
      it('file/blob download should fail with NotFound error', function () {
        return client.downloadJson(notFoundBlobName)
          .then(() => {
            logger.error('file/blob download should fail');
            throw new Error('expected file/blob download to fail');
          })
          .catch(err => {
            expect(err).to.be.an.instanceof(NotFound);
            expect(err.message).to.eql(`Object '${notFoundBlobName}' not found`);
          });
      });
      it('file/blob upload should be successful', function () {
        return client.uploadJson(validBlobName, jsonContent)
          .then(response => expect(response.content).to.eql(jsonContent.content));
      });
    });

    describe('#ComputeOperations', function () {
      let sandbox, client, reqStub;
      const zone = 'zone';
      const snapshotName = 'snappy';
      beforeEach(function () {
        sandbox = sinon.createSandbox();
        client = new AliClient(settings);
        reqStub = sandbox.stub(AliCompute.prototype, 'request');
        const params = {
          'RegionId': settings.region,
          'DiskIds': '[\'' + diskName + '\']'
        };
        const requestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        reqStub.withArgs('DescribeDisks', params, requestOption).callsFake(getDiskStub);

        const createDiskParams = {
          RegionId: 'region-name',
          ZoneId: 'zone',
          SnapshotId: 'snappy',
          DiskCategory: 'cloud_ssd',
          'Tag.1.Key': 'createdBy',
          'Tag.1.Value': 'service-fabrik' };
        const createDiskrequestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        reqStub.withArgs('CreateDisk', createDiskParams, createDiskrequestOption).callsFake(createDiskStub);

        const deleteSnapshotParams = {
          RegionId: 'region-name',
          'SnapshotId': 'snappy',
          'Force': true
        };
        const deleteSnapshotRequestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        reqStub.withArgs('DeleteSnapshot', deleteSnapshotParams, deleteSnapshotRequestOption).callsFake(deleteSnapshotStub);

      });
      afterEach(function () {
        sandbox.restore();
      });
      it('gets disk details successfully', function () {
        return client._getDiskDetails(diskName)
          .then(res => {
            expect(res.Status).to.eql('Available');
            expect(res.DiskId).to.eql(diskName);
          });
      });
      it('gets disk metadata successfully', function () {
        return client.getDiskMetadata(diskName)
          .then(res => {
            expect(res.volumeId).to.eql(diskName);
            expect(res.size).to.eql(20);
            expect(res.zone).to.eql(zone);
            expect(res.type).to.eql('cloud_ssd');
          });
      });
      it('throws error if get disk metadata fails', function () {
        sandbox.restore();
        const failedParams = {
          'RegionId': settings.region,
          'DiskIds': '[\'' + diskName + '\']'
        };
        const failedRequestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        sandbox.stub(AliCompute.prototype, 'request').withArgs('DescribeDisks', failedParams, failedRequestOption).callsFake(getDiskFailStub);
        return client.getDiskMetadata(diskName)
          .catch(err => {
            expect(err.message).to.eql('diskFailed');
          });
      });
      it('successfully waits for disk to be available', function () {
        const oldConst = CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY;
        CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = 0;
        return client._waitForDiskAvailability(diskName)
          .then(res => {
            expect(res.DiskId).to.eql(diskName);
            expect(res.Size).to.eql(20);
            expect(res.ZoneId).to.eql(zone);
            expect(res.Category).to.eql('cloud_ssd');
            CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = oldConst;
          });
      });
      it('wait for disk to be available times out with error', function () {
        const oldDelayConst = CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY;
        const oldToConst = CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC;
        CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = 1;
        CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC = 0.01;
        
        sandbox.restore();
        
        const failedParams = {
          'RegionId': settings.region,
          'DiskIds': '[\'' + diskName + '\']'
        };
        const failedRequestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        sandbox.stub(AliCompute.prototype, 'request').withArgs('DescribeDisks', failedParams, failedRequestOption).callsFake(getDiskFailStub);
        return client._waitForDiskAvailability(diskName)
          .catch(Timeout, () => {
            CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = oldDelayConst;
            CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC = oldToConst;
          });
      });
      it('successfully creates disk from snapshot', function () {
        const oldConst = CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY;
        CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = 0;

        return client.createDiskFromSnapshot(snapshotName, zone)
          .then(res => {
            expect(res.volumeId).to.eql(diskName);
            expect(res.size).to.eql(20);
            expect(res.zone).to.eql(zone);
            expect(res.type).to.eql('cloud_ssd');
            CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = oldConst;
          });
      });
      it('throws error if creates disk from snapshot fails', function () {
        const oldConst = CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY;
        CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = 0;

        sandbox.restore();
        const createDiskFailParams = {
          RegionId: 'region-name',
          ZoneId: 'zone',
          SnapshotId: 'snappy',
          DiskCategory: 'cloud_ssd',
          'Tag.1.Key': 'createdBy',
          'Tag.1.Value': 'service-fabrik' };
        const createDiskFailrequestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        sandbox.stub(AliCompute.prototype, 'request').withArgs('CreateDisk', createDiskFailParams, createDiskFailrequestOption).callsFake(getDiskFailStub);
        return client.createDiskFromSnapshot(snapshotName, zone)
          .catch(err => {
            expect(err.message).to.eql('diskFailed');
          });
      });
      it('wait for disk to be available times out', function () {
        const oldDelayConst = CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY;
        const oldToConst = CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC;
        
        CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = 1;
        CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC = 0.01;
        
        const timeParams = {
          'RegionId': settings.region,
          'DiskIds': '[\'' + diskName + '\']'
        };
        const timeRequestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        reqStub.withArgs('DescribeDisks', timeParams, timeRequestOption).callsFake(getDiskTimeoutStub);
        return client._waitForDiskAvailability(diskName)
          .catch(Timeout, err => {
            expect(err.message).to.eql('Volume with diskId disk-sample is not yet available. Current state is: Creating');
            CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY = oldDelayConst;
            CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC = oldToConst;
          });
      });

      it('successfully deletes snapshot', function () {
        return client.deleteSnapshot(snapshotName)
          .then(res => {
            expect(res).to.eql({});
          });
      });    
      it('throws error if delete snapshot fails', function () {
        sandbox.restore();
        const deleteSnapshotFailParams = {
          'RegionId': settings.region,
          'SnapshotId': 'snappy',
          'Force': true
        };
        const deleteSnapshotFailRequestOption = {
          timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
          method: 'POST'
        };
        sandbox.stub(AliCompute.prototype, 'request').withArgs('DeleteSnapshot', deleteSnapshotFailParams, deleteSnapshotFailRequestOption).callsFake(deleteSnapshotFailStub);
        return client.deleteSnapshot(snapshotName)
          .catch(err => {
            expect(err.message).to.eql('snapshotDeletionFailed');
          });
      });   

    });
  });
});
