'use strict';

// const _ = require('lodash');
const catalog = require('../../broker/lib/models/catalog');
const ScheduleManager = require('../../broker/lib/jobs/ScheduleManager');
// const CONST = require('../../common/constants');
// const backupStore = require('../../broker/lib/iaas').backupStore;
// const filename = backupStore.filename;

describe('managers', function () {
  describe('BackupManager', function () {
    let scheduleStub;
    before(function () {
      scheduleStub = sinon.stub(ScheduleManager, 'schedule', () => Promise.resolve({}));
    });
    afterEach(function () {
      mocks.reset();
      scheduleStub.reset();
    });
    after(function () {
      scheduleStub.restore();
    });

    // function isoDate(time) {
    //   return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
    // }

    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const deployment_name = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
    const BackupManager = require('../../managers/backup-manager/BackupManager');
    const plan = catalog.getPlan(plan_id);

    // const time = Date.now();
    // const started_at = isoDate(time);
    // const operation_backup = 'backup';
    // const prefix = `${space_guid}/backup/${service_id}.${instance_id}.${backup_guid}`;
    // const filename = `${prefix}.${started_at}.json`;
    // const container = backupStore.containerName;
    // const pathname = `/${container}/${filename}`;


    const manager = new BackupManager(plan);
    it('Should start backup successfully', function () {
      const context = {
        platform: 'cloudfoundry',
        organization_guid: organization_guid,
        space_guid: space_guid
      };
      const opts = {
        guid: backup_guid,
        deployment: deployment_name,
        instance_guid: instance_id,
        plan_id: plan_id,
        service_id: service_id,
        context: context
      };
      // const type = 'online';
      mocks.director.getDeploymentVms(deployment_name);
      mocks.director.getDeploymentInstances(deployment_name);
      mocks.agent.getInfo();
      mocks.agent.startBackup();
      // mocks.cloudProvider.upload(pathname, body => {
      //     expect(body.type).to.equal(type);
      //     expect(body.instance_guid).to.equal(instance_id);
      //     expect(body.backup_guid).to.equal(backup_guid);
      //     expect(body.trigger).to.equal(CONST.BACKUP.TRIGGER.ON_DEMAND);
      //     expect(body.state).to.equal('processing');
      //     return true;
      // });
      mocks.apiServerEventMesh.nockLoadSpec(3);
      mocks.apiServerEventMesh.nockPatchResourceRegex('backup', 'defaultbackup', {
        status: {
          state: 'in_progress'
        }
      }, 2);
      mocks.apiServerEventMesh.nockGetResourceRegex('backup', 'defaultbackup', {
        status: {
          state: 'in_progress'
        }
      });
      return manager.startBackup(opts)
        .then(() => {
          expect(scheduleStub.callCount).to.eql(1);
          mocks.verify();
        });
    });
  });
});