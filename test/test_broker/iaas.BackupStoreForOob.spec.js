'use strict';

const lib = require('../../broker/lib');
const CONST = require('../../broker/lib/constants');
const CloudProviderClient = lib.iaas.CloudProviderClient;
const backupStoreForOob = lib.iaas.backupStoreForOob;

describe('iaas', function () {
  describe('backupStoreForOob', function () {
    const deployment_name = 'ccdb-postgresql';
    describe('getFileNamePrefix', function () {

      it('should return the correct file name prefix', function () {
        const options = {
          root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME,
          deployment_name: deployment_name
        };
        const prefix = backupStoreForOob.getFileNamePrefix(options);
        expect(prefix).to.equal(`${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}/backup/${deployment_name}`);
      });

    });

    describe('findBackupFilename', function () {
      const backup_guid = 'some-guid';
      const started_at = new Date().toISOString();
      const backup_guid2 = 'some-guid2';
      const started_at2 = new Date().toISOString(); //latest date
      let sandbox, listStub;
      before(function () {
        sandbox = sinon.sandbox.create();
        listStub = sandbox.stub(CloudProviderClient.prototype, 'list');
        listStub.returns(Promise.resolve([{
          name: `${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}/backup/${deployment_name}.${backup_guid}.${started_at}`
        }, {
          name: `${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}/backup/${deployment_name}.${backup_guid2}.${started_at2}`
        }]));
      });
      afterEach(function () {
        listStub.reset();
      });
      after(function () {
        sandbox.restore();
      });

      it('should return the latest backupfile name', function () {
        const options = {
          root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME,
          deployment_name: deployment_name
        };
        return backupStoreForOob.findBackupFilename(options)
          .then(filename => {
            expect(filename.deployment_name).to.equal(deployment_name);
            expect(filename.backup_guid).to.equal(backup_guid2);
            expect(filename.root_folder).to.equal(CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME);
          });

      });

      it('should return the correct backupfile name', function () {
        listStub.returns(Promise.resolve([{
          name: `${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}/backup/${deployment_name}.${backup_guid}.${started_at}`
        }]));
        const options = {
          root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME,
          deployment_name: deployment_name,
          backup_guid: backup_guid
        };
        return backupStoreForOob.findBackupFilename(options)
          .then(filename => {
            expect(filename.deployment_name).to.equal(deployment_name);
            expect(filename.backup_guid).to.equal(backup_guid);
            expect(filename.root_folder).to.equal(CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME);
          });

      });

    });

    describe('listBackupFilenames', function () {
      let sandbox, listStub;
      const deployment_name = 'ccdb-postgresql';
      const oob_backup_guid = 'oob-backup-guid';
      const service_instance_backup_guid = 'service-instance-backup-guid';
      const tenant_id = 'space-guid';
      const service_guid = 'service-guid';
      const instance_guid = 'instance-guid';
      const oob_backup_started_at_suffix = new Date((new Date()).getTime() - 1000 * 600).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
      const service_instance_backup_started_at_suffix = new Date((new Date()).getTime() - 1000 * 600).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
      const operation = 'backup';
      before(function () {
        sandbox = sinon.sandbox.create();
        listStub = sandbox.stub(CloudProviderClient.prototype, 'list');
        listStub.returns(Promise.resolve([{
          name: `${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}/${operation}/${deployment_name}.${oob_backup_guid}.${oob_backup_started_at_suffix}.json`
        }, {
          name: `${tenant_id}/${operation}/${service_guid}.${instance_guid}.${service_instance_backup_guid}.${service_instance_backup_started_at_suffix}.json`
        }]));
      });
      afterEach(function () {
        listStub.reset();
      });
      after(function () {
        sandbox.restore();
      });

      it('should list all OOB backup file names', function () {
        return backupStoreForOob.listBackupFilenames(Date.now()).then(filenameObject => {
          expect(filenameObject).to.have.lengthOf(1);
          expect(filenameObject[0].deployment_name).to.equal(deployment_name);
        });
      });
    });
  });
});