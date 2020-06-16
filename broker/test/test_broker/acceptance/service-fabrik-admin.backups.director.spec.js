'use strict';

const _ = require('lodash');
const app = require('../support/apps').admin;
const config = require('@sf/app-config');
const {
  backupStore,
  CloudProviderClient
} = require('@sf/iaas');
const filename = backupStore.filename;

describe('service-fabrik-admin', function () {
  describe('backups', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/admin';
      const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const started_at = '2015-11-18T11:28:42Z';
      const index = 0;
      const instance_id = mocks.director.uuidByIndex(index);
      const container = backupStore.containerName;
      const blueprintContainer = `${backupStore.containerPrefix}-blueprint`;
      const operation = 'backup';
      const filenameObject = {
        operation: operation,
        service_id: service_id,
        plan_id: plan_id,
        instance_guid: instance_id,
        backup_guid: backup_guid,
        started_at: started_at,
        tenant_id: space_guid
      };
      const backups = [_.omit(filenameObject, 'operation', 'plan_id')];
      const filenameObj = filename.create(filenameObject).name;
      const pathname = `/${container}/${filenameObj}`;
      const data = {
        backup_guid: backup_guid,
        instance_guid: instance_id,
        service_id: service_id,
        state: 'succeeded',
        logs: []
      };
      const archiveFilename = `${backup_guid}/volume.tgz.enc`;
      const archivePathname = `/${blueprintContainer}/${archiveFilename}`;

      before(function () {
        backupStore.cloudProvider = new CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        return mocks.setup([
          backupStore.cloudProvider.getContainer()
        ]);
      });

      afterEach(function () {
        mocks.reset();
      });

      describe('#getListOfBackups', function () {
        it('should list all backups before the specified timestamp', function () {
          mocks.cloudProvider.list(container, undefined, [filenameObj]);
          return chai
            .request(app)
            .get(`${base_url}/backups`)
            .query({
              before: '2015-11-18T11:28:43Z'
            })
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res.body.backups).to.have.length(1);
              expect(res.body.backups).to.eql(backups);
              expect(res).to.have.status(200);
              mocks.verify();
            });
        });

        it('should error on invalid date input', function () {
          return chai
            .request(app)
            .get(`${base_url}/backups`)
            .query({
              before: 'invalid-date'
            })
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
            });
        });
      });

      describe('#deleteBackup', function () {
        const prefix = `${space_guid}/${operation}/${service_id}.${instance_id}.${backup_guid}`;
        it('should successfully delete an existing backup', function () {
          mocks.cloudProvider.list(container, prefix, [filenameObj]);
          mocks.cloudProvider.remove(pathname);
          mocks.cloudProvider.download(pathname, data);
          mocks.cloudProvider.list(blueprintContainer, backup_guid, [archiveFilename]);
          mocks.cloudProvider.remove(archivePathname);
          const body = _.pick(filenameObject, 'service_id', 'plan_id', 'instance_guid', 'space_guid');
          body.space_guid = filenameObject.tenant_id;
          return chai
            .request(app)
            .post(`${base_url}/backups/${backup_guid}/delete`)
            .send(body)
            .set('Accept', 'application/json')
            .auth(config.username, config.password)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });

    });
  });
});
