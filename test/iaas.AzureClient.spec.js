'use strict';

const lib = require('../lib');
const azureStorage = require('azure-storage');
const AzureClient = lib.iaas.AzureClient;
const CONST = require('../lib/constants');
const logger = require('../lib/logger');
const errors = require('../lib/errors');
const moment = require('moment');
const filename = lib.iaas.backupStore.filename;
const NotFound = errors.NotFound;
const Forbidden = errors.Forbidden;
const Unauthorized = errors.Unauthorized;

describe('iaas', function () {
  describe('AzureClient', function () {

    const createBlobServiceSpy = sinon.spy(azureStorage, 'createBlobService');
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const scheduled_data = {
      trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
      type: 'online',
      state: 'succeeded',
      backup_guid: backup_guid,
      started_at: filename.isoDate(moment().subtract(1, 'days').toISOString()),
      agent_ip: mocks.agent.ip,
      service_id: service_id
    };

    afterEach(function () {
      createBlobServiceSpy.reset();
    });

    const settings = mocks.azureClient.config.backup.provider;

    describe('#constructor', function () {
      it('should create an AzureClient instance', function () {
        const client = new AzureClient(settings);
        expect(client.provider).to.equal('azure');
        expect(createBlobServiceSpy)
          .to.be.calledWith(settings.storageAccount, settings.storageAccessKey);
      });
    });

    describe('#BlobOperations', function () {
      const client = new AzureClient(settings);
      const blobName = 'blob1';

      afterEach(function () {
        mocks.reset();
      });

      it('blob list operation should be successful', function () {
        mocks.reset();
        const blobList = ['blob1.txt', 'blob2.txt'];
        const expectedResponse = {
          headers: {
            'transfer-encoding': 'chunked',
            'content-type': 'application/xml',
            server: 'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0',
            'x-ms-request-id': '2376cafa-0001-002e-1e01-6716c0000000',
            'x-ms-version': '2016-05-31',
            date: new Date().toISOString()
          },
          status: 200,
          body: `<?xml version="1.0" encoding="utf-8"?>  
          <EnumerationResults ContainerName="https://${settings.storageAccount}.blob.core.windows.net/${settings.container}">  
            <Blobs>
              <Blob>
                <Name>${blobList[0]}</Name>  
                <Url>https://${settings.storageAccount}.blob.core.windows.net/${settings.container}/${blobList[0]}</Url>  
                <Properties>
                  <Last-Modified>Wed, 09 Sep 2016 09:20:02 GMT</Last-Modified>  
                  <Etag>0x8CBFF45D8A29A19</Etag>  
                  <Content-Length>100</Content-Length>  
                  <Content-Type>text/html</Content-Type>  
                  <Content-Encoding />  
                  <Content-Language>en-US</Content-Language>  
                  <Content-MD5 />  
                  <Cache-Control>no-cache</Cache-Control>  
                  <BlobType>BlockBlob</BlobType>  
                  <LeaseStatus>unlocked</LeaseStatus>  
                </Properties>
                <Metadata>  
                  <Color>blue</Color>  
                  <BlobNumber>01</BlobNumber>  
                </Metadata>  
              </Blob>
              <Blob>
                <Name>${blobList[1]}</Name>
                <Url>https://${settings.storageAccount}.blob.core.windows.net/${settings.container}/${blobList[1]}</Url>  
                <Properties>  
                  <Last-Modified>Wed, 09 Sep 2016 09:20:02 GMT</Last-Modified>  
                  <Etag>0x8CBFF45D8B4C212</Etag>  
                  <Content-Length>5000</Content-Length>  
                  <Content-Type>application/octet-stream</Content-Type>  
                  <Content-Encoding>gzip</Content-Encoding>  
                  <Content-Language />  
                  <Content-MD5 />  
                  <Cache-Control />  
                  <BlobType>BlockBlob</BlobType>  
                </Properties>  
                <Metadata>  
                  <Color>green</Color>  
                  <BlobNumber>02</BlobNumber>  
                </Metadata>  
              </Blob>
            </Blobs>  
            <NextMarker />   
          </EnumerationResults>`
        };
        mocks.azureClient.list(settings.container, undefined, expectedResponse);
        return client.list()
          .then(files => {
            expect(files).to.have.length(blobList.length);
            expect(files[0].name).to.eql(blobList[0]);
            expect(files[1].name).to.eql(blobList[1]);
            expect(files[0].isTruncated).to.eql(false);
            expect(files[1].isTruncated).to.eql(false);
            mocks.verify();
          });
      });

      it('blob upload should be successful', function () {
        mocks.azureClient.upload(`/${settings.container}/${blobName}`, {
          status: 201,
          headers: {
            'transfer-encoding': 'chunked',
            'content-md5': '+v4bYMJBB8zY9FYiE+RISQ==',
            'last-modified': 'Thu, 05 Jan 2017 03:13:04 GMT',
            etag: '"0x8D43518C381D87C"',
            server: 'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0',
            'x-ms-request-id': '5dc67ddb-0001-003d-7701-672321000000',
            'x-ms-version': '2016-05-31',
            date: new Date().toISOString()
          },
          body: scheduled_data
        }, 2);
        return client.uploadJson(blobName, scheduled_data)
          .then(result => {
            expect(result).to.eql(scheduled_data);
            mocks.verify();
          });
      });

      // This is a generic precondition fail check, want to test
      // even in this case also our code is able to handle the error.
      it('blob upload should fail: PreconditionFailed', function () {
        mocks.azureClient.upload(`/${settings.container}/${blobName}`, {
          status: 412,
          body: '<?xml version=\"1.0\" encoding=\"utf-8\"?><Error><Code>ConditionNotMet</Code><Message>The condition specified using HTTP conditional header(s) is not met.\nRequestId:879cee1d-0001-003e-4001-672026000000\nTime:2017-01-05T03:13:51.1418462Z</Message></Error>',
          headers: {
            'content-length': '252',
            'content-type': 'application/xml',
            server: 'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0',
            'x-ms-request-id': '879cee1d-0001-003e-4001-672026000000',
            'x-ms-version': '2016-05-31',
            date: new Date().toISOString()
          }
        });
        return client.uploadJson(blobName, scheduled_data)
          .then(() => {
            throw new Error('Upload data should have thrown error');
          })
          .catch(err => {
            expect(err.statusCode || err.code).to.eql(412);
            mocks.verify();
          });

      });

      it('blob download should be successful', function () {
        mocks.azureClient.download(`/${settings.container}/${blobName}`, scheduled_data, {
          'content-type': 'application/octet-stream',
          'last-modified': 'Thu, 05 Jan 2017 03:08:55 GMT',
          etag: '"0x8D435182F901B41"',
          server: 'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0',
          'x-ms-request-id': '2838475d-0001-0002-1101-6794fd000000',
          'x-ms-version': '2016-05-31',
          date: new Date().toISOString()
        });
        mocks.azureClient.headObject(`/${settings.container}/${blobName}`);
        return client.downloadJson(`${blobName}`)
          .then(data => {
            expect(data).to.eql(scheduled_data);
            mocks.verify();
          });
      });

      it('blob download should fail: NotFound error', function () {
        mocks.azureClient.headObject(`/${settings.container}/${blobName}`, 404);
        return client.downloadJson(`${blobName}`)
          .catch(err => {
            expect(err).to.be.instanceof(NotFound);
            mocks.verify();
          });
      });

      it('blob download should fail on non json body: NotFound error', function () {
        mocks.azureClient.download(`/${settings.container}/${blobName}`, 'Hello World', {
          'content-type': 'application/octet-stream',
          'last-modified': 'Thu, 05 Jan 2017 03:08:55 GMT',
          etag: '"0x8D435182F901B41"',
          server: 'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0',
          'x-ms-request-id': '2838475d-0001-0002-1101-6794fd000000',
          'x-ms-version': '2016-05-31',
          date: new Date().toISOString()
        });
        mocks.azureClient.headObject(`/${settings.container}/${blobName}`);
        return client.downloadJson(`${blobName}`)
          .then(() => {
            throw new Error('DownloadJson should have thrown error');
          })
          .catch(NotFound, () => {
            mocks.verify();
          });
      });


      it('blob deletion should be successful', function () {
        mocks.azureClient.remove(`/${settings.container}/${blobName}`, {
          status: 202,
          headers: {
            'transfer-encoding': 'chunked',
            server: 'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0',
            'x-ms-request-id': '774c96e7-0001-0006-7e01-67617f000000',
            'x-ms-version': '2016-05-31',
            date: new Date().toISOString()
          }
        });
        return client.remove(`${blobName}`)
          .then((result) => {
            expect(result).to.eql(undefined);
            mocks.verify();
          });
      });

      it('blob deletion should fail: NotFound error', function () {
        mocks.azureClient.remove(`/${settings.container}/${blobName}`, {
          status: 404,
          headers: {
            'x-ms-request-id': '774c96e7-0001-0006-7e01-67617f000000',
            'x-ms-version': '2016-05-31',
            date: new Date().toISOString()
          }
        });
        return client.remove(`${blobName}`)
          .catch(err => {
            expect(err).to.be.instanceof(NotFound);
            mocks.verify();
          });
      });

      it('blob deletion should fail: Unauthorized error', function () {
        mocks.azureClient.remove(`/${settings.container}/${blobName}`, {
          status: 401,
          headers: {
            'x-ms-request-id': '774c96e7-0001-0006-7e01-67617f000000',
            'x-ms-version': '2016-05-31',
            date: new Date().toISOString()
          }
        });
        return client.remove(`${blobName}`)
          .catch(err => {
            expect(err).to.be.instanceof(Unauthorized);
            mocks.verify();
          });
      });

      it('blob deletion should fail: Forbidden error', function () {
        mocks.azureClient.remove(`/${settings.container}/${blobName}`, {
          status: 403,
          headers: {
            'x-ms-request-id': '774c96e7-0001-0006-7e01-67617f000000',
            'x-ms-version': '2016-05-31',
            date: new Date().toISOString()
          }
        });
        return client.remove(`${blobName}`)
          .catch(err => {
            expect(err).to.be.instanceof(Forbidden);
            mocks.verify();
          });
      });

      it('container properties should be retrived successfully', function () {
        const headers = {
          'transfer-encoding': 'chunked',
          'x-ms-meta-Name': 'StorageSample',
          'last-modified': 'Thu, 05 Jan 2017 03:13:04 GMT',
          etag: '"0x8D43518C381D87C"',
          server: 'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0',
          'x-ms-request-id': '5dc67ddb-0001-003d-7701-672321000000',
          'x-ms-version': '2016-05-31',
          'x-ms-blob-public-access': 'blob',
          date: new Date().toISOString()
        };
        mocks.azureClient.getContainer(`/${settings.container}?restype=container`, headers);
        return client.getContainer(`${settings.container}`)
          .then(result => {
            logger.info('Result:', result, headers['x-ms-request-id'], result.requestId);
            expect(result.name).to.eql(settings.container);
            expect(result.etag).to.eql(headers.etag);
            expect(result.lastModified).to.eql(headers['last-modified']);
            expect(result.requestId).to.eql(headers['x-ms-request-id']);
            expect(result.publicAccessLevel).to.eql(headers['x-ms-blob-public-access']);
            expect(result.metadata).to.eql({
              Name: headers['x-ms-meta-Name']
            });
            mocks.verify();
          });
      });

    });

    describe('#SnapshotTests', function () {
      const client = new AzureClient(settings);
      afterEach(function () {
        mocks.reset();
      });
      it('delete snapshot should be successful', function () {
        const snapshotName = 'snapshot1';
        mocks.azureClient.auth();
        mocks.azureClient.deleteSnapshot(
          `/subscriptions/${settings.subscription_id}/resourceGroups/${settings.resource_group}/providers/Microsoft.Compute/snapshots/${snapshotName}?api-version=2016-04-30-preview`, {
            status: 204,
            headers: {
              'x-ms-request-id': '774c96e7-0001-0006-7e01-67617f000000',
              'x-ms-version': '2016-05-31',
              date: new Date().toISOString()
            }
          });
        return client.deleteSnapshot(snapshotName)
          .then((result) => {
            expect(result).to.equal(undefined);
            mocks.verify();
          });
      });

      it('should bubble up error if snapshot delete failed', function () {
        const snapshotName = 'fake-snap';
        const errorMessageExpected = 'fake-snap not found';
        mocks.azureClient.auth();
        mocks.azureClient.deleteSnapshot(
          `/subscriptions/${settings.subscription_id}/resourceGroups/${settings.resource_group}/providers/Microsoft.Compute/snapshots/${snapshotName}?api-version=2016-04-30-preview`,
          undefined, errorMessageExpected);
        return client.deleteSnapshot(snapshotName)
          .catch(err => expect(err.message).to.equal(errorMessageExpected));
      });

    });

  });
});