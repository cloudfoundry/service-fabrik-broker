'use strict';

const _ = require('lodash');
const app = require('../support/apps').external;
const config = require('../../../common/config');
const iaas = require('../../../data-access-layer/iaas');
const backupStore = iaas.backupStore;

function enableServiceFabrikV2() {
  config.enable_service_fabrik_v2 = true;
}

function disableServiceFabrikV2() {
  config.enable_service_fabrik_v2 = false;
}

describe('service-fabrik-api', function () {
  describe('backups-v2', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/api/v1';
      const authHeader = `bearer ${mocks.uaa.jwtToken}`;
      const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
      const backup_guid1 = 'xxxxxx-66a3-471b-af3c-8bbf1e4180be';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const container = backupStore.containerName;
      const instance_id = 'ab0ed6d6-42d9-4318-9b65-721f34719499';
      const instance_id1 = '6666666-42d9-4318-9b65-721f34719499';
      const started_at = '2015-11-18T11-28-42Z';
      const prefix = `${space_guid}/backup`;
      const filename = `${prefix}/${service_id}.${instance_id}.${backup_guid}.${started_at}.json`;
      const filename1 = `${prefix}/${service_id}.${instance_id1}.${backup_guid1}.${started_at}.json`;
      const pathname = `/${container}/${filename}`;
      const pathname1 = `/${container}/${filename1}`;
      const data = {
        backup_guid: backup_guid,
        instance_guid: instance_id,
        service_id: service_id,
        state: 'succeeded',
        logs: []
      };
      const data1 = {
        backup_guid: backup_guid1,
        instance_guid: instance_id1,
        service_id: service_id,
        state: 'succeeded',
        logs: []
      };

      before(function () {
        enableServiceFabrikV2();
        backupStore.cloudProvider = new iaas.CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        return mocks.setup([
          backupStore.cloudProvider.getContainer()
        ]);
      });

      after(function () {
        disableServiceFabrikV2();
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
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource('backup', 'defaultbackup', backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 3);
          mocks.apiServerEventMesh.nockPatchResource('backup', 'defaultbackup', backup_guid, {});
          mocks.apiServerEventMesh.nockPatchResourceStatus('backup', 'defaultbackup', {});
          mocks.apiServerEventMesh.nockDeleteResource('backup', 'defaultbackup', backup_guid);
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
          mocks.apiServerEventMesh.nockGetResource('backup', 'defaultbackup', backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 3);
          mocks.apiServerEventMesh.nockPatchResource('backup', 'defaultbackup', backup_guid, {});
          mocks.apiServerEventMesh.nockPatchResourceStatus('backup', 'defaultbackup', {});
          mocks.apiServerEventMesh.nockDeleteResource('backup', 'defaultbackup', backup_guid);
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
          mocks.apiServerEventMesh.nockGetResource('backup', 'defaultbackup', backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 3);
          mocks.apiServerEventMesh.nockPatchResource('backup', 'defaultbackup', backup_guid, {});
          mocks.apiServerEventMesh.nockPatchResourceStatus('backup', 'defaultbackup', {});
          mocks.apiServerEventMesh.nockDeleteResource('backup', 'defaultbackup', backup_guid);
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
        it('should return 410 Gone', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource('backup', 'defaultbackup',
            '01234567-0000-4000-9000-0123456789ab', {}, 1, 404);
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