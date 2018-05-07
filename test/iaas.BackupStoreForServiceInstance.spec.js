'use strict';

const lib = require('../broker/lib');
const CONST = require('../broker/lib/constants');
const CloudProviderClient = lib.iaas.CloudProviderClient;
const backupStore = lib.iaas.backupStore;

describe('iaas', function () {
  describe('backupStoreForServiceInstance', function () {
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

      it('should list all service instance backup file names', function () {
        return backupStore.listBackupFilenames(Date.now()).then(filenameObject => {
          expect(filenameObject).to.have.lengthOf(1);
          expect(filenameObject[0].tenant_id).to.equal(tenant_id);
        });
      });
    });
  });
});