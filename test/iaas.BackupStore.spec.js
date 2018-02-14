'use strict';

const lib = require('../lib');
const CONST = require('../lib/constants');
const CloudProviderClient = lib.iaas.CloudProviderClient;
const backupStore = lib.iaas.backupStore;

describe('iaas', function () {
  describe('backupStore', function () {
    describe('listBackupFilenames', function () {
      let sandbox, listStub;
      const deployment_name = 'ccdb-postgresql';
      const oob_backup_guid = 'oob-backup-guid';
      const service_instance_backup_guid = 'service-instance-backup-guid';
      const space_guid = 'space-guid';
      const service_guid = 'service-guid';
      const instance_guid = 'instance-guid';
      const oob_backup_started_at_suffix = new Date().toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
      const service_instance_backup_started_at_suffix = new Date().toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
      const operation = "backup";
      before(function () {
        sandbox = sinon.sandbox.create();
        listStub = sandbox.stub(CloudProviderClient.prototype, 'list');
        listStub.returns(Promise.resolve([{
          name: `${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}/${operation}/${deployment_name}.${oob_backup_guid}.${oob_backup_started_at_suffix}.json`
        }, {
          name: `${space_guid}/${operation}/${service_guid}.${instance_guid}.${service_instance_backup_guid}.${service_instance_backup_started_at_suffix}.json`
        }]));
      });
      afterEach(function () {
        listStub.reset();
      });
      after(function () {
        sandbox.restore();
      });

      it('should list all service instance backup file names', function () {
        var files = backupStore.listBackupFilenames(Date.now()).then(filenameObject => {
          expect(filenameObject.service_id).to.equal(service_guid);
          expect(filenameObject.space_guid).to.equal(space_guid);
          expect(filenameObject.instance_guid).to.equal(instance_guid);
          expect(filenameObject.operation).to.equal(operation);
          expect(filenameObject.started_at).to.equal(service_instance_backup_started_at_suffix.replace(/:/g, '-'));
        });

      });
    });
  })
});