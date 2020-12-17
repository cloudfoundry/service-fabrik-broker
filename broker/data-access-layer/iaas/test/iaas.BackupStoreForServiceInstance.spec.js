'use strict';

const { CONST } = require('@sf/common-utils');
const {
  backupStore,
  CloudProviderClient
} = require('@sf/iaas');
const _ = require('lodash');

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
        sandbox = sinon.createSandbox();
        listStub = sandbox.stub(CloudProviderClient.prototype, 'list');
        listStub.returns(Promise.resolve([{
          name: `${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}/${operation}/${deployment_name}.${oob_backup_guid}.${oob_backup_started_at_suffix}.json`
        }, {
          name: `${tenant_id}/${operation}/${service_guid}.${instance_guid}.${service_instance_backup_guid}.${service_instance_backup_started_at_suffix}.json`
        }]));
      });
      afterEach(function () {
        listStub.resetHistory();
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

  describe('deleteServiceBackup', function () {
    let sandbox, deleteSnapshotStub, listStub, removeStub;
    const filename = 'dummy_name.json'
    const data = {
      'trigger': CONST.BACKUP.TRIGGER.MANUAL,
      'state': 'succeeded',
      'backup_guid': 'dummy-backup-guid',
      'started_at': new Date((new Date()).getTime()).toISOString(),
      'snapshotId': 'dummy-snapshotId'
    }
    const options = {
      'container': 'dummy-container-blueprint'
    }
    const errorMsg = 'Test case failed'

    before(function () {
      sandbox = sinon.createSandbox();
      deleteSnapshotStub = sandbox.stub(CloudProviderClient.prototype, 'deleteSnapshot');
      listStub = sandbox.stub(CloudProviderClient.prototype, 'list');
      removeStub = sandbox.stub(CloudProviderClient.prototype, 'remove');
      listStub.returns(Promise.resolve([{
        name: filename
      }]));
    });

    afterEach(function () {
      deleteSnapshotStub.resetHistory();
    });

    after(function () {
      sandbox.restore();
    });

    it('should delete backup blob and snapshot', function () {
      return backupStore.deleteServiceBackup(data, options)
        .then(() => {
          expect(removeStub).to.have.been.calledWith(options.container, filename);
          expect(deleteSnapshotStub).to.have.been.calledOnce;
        })
    });

    it('should not delete snapshot if validation fails', function () {
      // deleteServiceBackup should fails since,
      // delete of scheduled backup is not permitted within retention period.
      const test_data = _.assign({}, data, { 'trigger': CONST.BACKUP.TRIGGER.SCHEDULED })
      return backupStore.deleteServiceBackup(test_data, options)
        .then(() => {
          throw new Error(errorMsg);
        })
        .catch(err => {
          // Failing the test case if .then() is called
          expect(err).to.not.have.property('message', errorMsg);
          expect(err).to.have.status(CONST.HTTP_STATUS_CODE.FORBIDDEN);
          expect(deleteSnapshotStub).to.have.not.been.called;
        });
    });

    it('should fail if backup creation is ongoing', function () {
      // deleteServiceBackup should fails since,
      // delete of backup is not permitted when the state is in processing.
      const test_data = _.assign({}, data, { 'state': 'processing' })
      return backupStore.deleteServiceBackup(test_data, options)
        .then(() => {
          throw new Error(errorMsg);
        })
        .catch(err => {
          expect(err).to.not.have.property('message', errorMsg);
          expect(err).to.have.status(CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);
          expect(deleteSnapshotStub).to.have.not.been.called;
        });
    });
  });
});
