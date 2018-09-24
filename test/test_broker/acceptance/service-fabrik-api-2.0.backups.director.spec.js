'use strict';

const _ = require('lodash');
const app = require('../support/apps').external;
const config = require('../../../common/config');
const CONST = require('../../../common/constants');
const iaas = require('../../../data-access-layer/iaas');
const backupStore = iaas.backupStore;

describe('service-fabrik-api-2.0', function () {
  describe('backups', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/api/v1';
      const authHeader = `bearer ${mocks.uaa.jwtToken}`;
      const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
      const backup_guid1 = 'xxxxxx-66a3-471b-af3c-8bbf1e4180be';
      const backup_guid2 = 'abcdefab-66a3-471b-af3c-8bbf1e4180be';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const container = backupStore.containerName;
      const instance_id = 'ab0ed6d6-42d9-4318-9b65-721f34719499';
      const instance_id1 = '6666666-42d9-4318-9b65-721f34719499';
      const instance_id2 = '6666677-42d9-4318-9b65-721f34719499';
      const started_at = backupStore.filename.isoDate(new Date(Date.now() - 2 * 60 * 60 * 24 * 1000));
      const dateOlderthanRetentionPeriod = backupStore.filename.isoDate(new Date(Date.now() - (config.backup.retention_period_in_days + 1) * 60 * 60 * 24 * 1000));
      const prefix = `${space_guid}/backup`;
      const filename = `${prefix}/${service_id}.${instance_id}.${backup_guid}.${started_at}.json`;
      const filename1 = `${prefix}/${service_id}.${instance_id1}.${backup_guid1}.${started_at}.json`;
      const filename2 = `${prefix}/${service_id}.${instance_id2}.${backup_guid2}.${dateOlderthanRetentionPeriod}.json`;
      const pathname = `/${container}/${filename}`;
      const pathname1 = `/${container}/${filename1}`;
      const pathname2 = `/${container}/${filename2}`;
      const data = {
        backup_guid: backup_guid,
        instance_guid: instance_id,
        service_id: service_id,
        started_at: started_at,
        state: 'succeeded',
        logs: []
      };
      const data1 = {
        backup_guid: backup_guid1,
        instance_guid: instance_id1,
        service_id: service_id,
        started_at: started_at,
        state: 'succeeded',
        logs: []
      };

      const data2 = {
        backup_guid: backup_guid2,
        instance_guid: instance_id2,
        service_id: service_id,
        started_at: dateOlderthanRetentionPeriod,
        state: 'succeeded',
        logs: []
      };

      before(function () {
        backupStore.cloudProvider = new iaas.CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        return mocks.setup([
          backupStore.cloudProvider.getContainer()
        ]);
      });

      after(function () {
        backupStore.cloudProvider = iaas.cloudProvider;
      });

      afterEach(function () {
        mocks.reset();
      });

      describe('#listBackups', function () {
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename, filename1]);
          mocks.cloudProvider.download(pathname, data);
          mocks.cloudProvider.download(pathname1, data1);
          return chai.request(app)
            .get(`${base_url}/backups`)
            .query({
              space_guid: space_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data, 'logs'), _.omit(data1, 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });

        it('should return 200 OK - only backups with after time', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename, filename1, filename2]);
          mocks.cloudProvider.download(pathname, data);
          mocks.cloudProvider.download(pathname1, data1);
          mocks.cloudProvider.download(pathname2, data2);
          const afterDate = backupStore.filename.isoDate(new Date(Date.now() - (config.backup.retention_period_in_days + 5) * 60 * 60 * 24 * 1000));
          return chai.request(app)
            .get(`${base_url}/backups`)
            .query({
              space_guid: space_guid,
              after: afterDate
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data2, 'logs'), _.omit(data, 'logs'), _.omit(data1, 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });

        it('should return 200 OK - only backups with before time', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename, filename1, filename2]);
          mocks.cloudProvider.download(pathname2, data2);
          const beforeDate = backupStore.filename.isoDate(new Date(Date.now() - (config.backup.retention_period_in_days - 1) * 60 * 60 * 24 * 1000));
          const afterDate = backupStore.filename.isoDate(new Date(Date.now() - (config.backup.retention_period_in_days + 5) * 60 * 60 * 24 * 1000));
          return chai.request(app)
            .get(`${base_url}/backups`)
            .query({
              space_guid: space_guid,
              before: beforeDate,
              after: afterDate
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data2, 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });

        it('should return 200 OK - with platform', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename]);
          mocks.cloudProvider.download(pathname, data);
          return chai.request(app)
            .get(`${base_url}/backups`)
            .query({
              space_guid: space_guid,
              platform: 'cloudfoundry'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data, 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });
        it('should return 200 OK - with random platform defaults to cf', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename]);
          mocks.cloudProvider.download(pathname, data);
          return chai.request(app)
            .get(`${base_url}/backups`)
            .query({
              space_guid: space_guid,
              platform: 'random'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data, 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });
        it('should return 200 OK - with instance_id parameter, returns only one metadata file data', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudController.findServicePlanByInstanceId(instance_id, undefined, undefined, []);
          mocks.cloudProvider.list(container, prefix, [filename, filename1]);
          mocks.cloudProvider.download(pathname, data);
          return chai.request(app)
            .get(`${base_url}/backups`)
            .query({
              space_guid: space_guid,
              instance_id: instance_id
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data, 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });
      });

      describe('#getBackup', function () {
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename]);
          mocks.cloudProvider.download(pathname, data);
          return chai.request(app)
            .get(`${base_url}/backups/${backup_guid}`)
            .query({
              space_guid: space_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(data);
              mocks.verify();
            });
        });
        it('should return 200 OK - with platform', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename]);
          mocks.cloudProvider.download(pathname, data);
          return chai.request(app)
            .get(`${base_url}/backups/${backup_guid}`)
            .query({
              space_guid: space_guid,
              platform: 'cloudfoundry'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(data);
              mocks.verify();
            });
        });
        it('should return 200 OK - with random platform defaults to cf', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [filename]);
          mocks.cloudProvider.download(pathname, data);
          return chai.request(app)
            .get(`${base_url}/backups/${backup_guid}`)
            .query({
              space_guid: space_guid,
              platform: 'random'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(data);
              mocks.verify();
            });
        });
      });

      describe('#deleteBackup', function () {
        let sandbox, delayStub;
        before(function () {
          sandbox = sinon.sandbox.create();
          delayStub = sandbox.stub(Promise, 'delay', () => Promise.resolve(true));
        });

        after(function () {
          delayStub.restore();
        });

        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid);
          return chai.request(app)
            .delete(`${base_url}/backups/${backup_guid}`)
            .query({
              space_guid: space_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it('should return 200 OK - with platform', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid);
          return chai.request(app)
            .delete(`${base_url}/backups/${backup_guid}`)
            .query({
              space_guid: space_guid,
              platform: 'cloudfoundry'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
        it('should return 200 OK - with random platform defaults to cf', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid);
          return chai.request(app)
            .delete(`${base_url}/backups/${backup_guid}`)
            .query({
              space_guid: space_guid,
              platform: 'random'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
        it('should return 410 Gone - when not found in both blobstore and apiserver', function () {
          const backupPrefix = `${space_guid}/backup`;
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            '01234567-0000-4000-9000-0123456789ab', {}, 1, 404);
          mocks.cloudProvider.list(container, backupPrefix, []);
          return chai.request(app)
            .delete(`${base_url}/backups/01234567-0000-4000-9000-0123456789ab`)
            .query({
              space_guid: space_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(410);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });
    });
  });
});