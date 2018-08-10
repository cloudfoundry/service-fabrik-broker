'use strict';

const catalog = require('../../common/models/catalog');
const RestoreService = require('../../managers/restore-manager/RestoreService');
const moment = require('moment');
const iaas = require('../../data-access-layer/iaas');
const backupStore = iaas.backupStore;

describe('managers', function () {
  describe('RestoreService', function () {

    function isoDate(time) {
      return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
    }

    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const plan = catalog.getPlan(plan_id);
    const manager = new RestoreService(plan);
    const deployment_name = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const time = Date.now();
    const username = 'fakeUsername';
    const started_at = isoDate(time);
    const restorePrefix = `${space_guid}/restore/${service_id}.${instance_id}`;
    const container = backupStore.containerName;
    const restoreFilename = `${restorePrefix}.json`;
    const restorePathname = `/${container}/${restoreFilename}`;
    const restoreMetadata = {
      plan_id: plan_id,
      state: 'succeeded',
      type: 'online',
      secret: 'fakeSecret',
      started_at: started_at,
      trigger: 'online',
      restore_dates: {
        succeeded: [moment(time).subtract(2, 'days').toDate().toISOString(), moment(time).subtract(40, 'days').toDate().toISOString()]
      }
    };
    const restore_options = {
      plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
      service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
      context: {
        platform: 'cloudfoundry',
        organization_guid: 'c84c8e58-eedc-4706-91fb-e8d97b333481',
        space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
      },
      instance_guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
      deployment: deployment_name,
      arguments: {
        backup_guid: '071acb05-66a3-471b-af3c-8bbf1e4180be',
        backup: {
          type: 'online',
          secret: 'fakeSecret'
        }
      },
      username: username
    };

    describe('#startRestore', function () {
      it('Should start restore successfully', function () {
        mocks.cloudProvider.download(restorePathname, restoreMetadata);
        mocks.cloudProvider.auth();
        mocks.director.getDeploymentVms(deployment_name);
        mocks.director.getDeploymentInstances(deployment_name);
        mocks.agent.getInfo(2);
        mocks.cloudProvider.headObject(restorePathname);
        mocks.agent.startRestore();
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.instance_guid).to.equal(instance_id);
          expect(body.username).to.equal(username);
          expect(body.backup_guid).to.equal(backup_guid);
          expect(body.state).to.equal('processing');
          expect(body.restore_dates.succeeded.length).to.equal(2);
          return true;
        });
        return manager.startRestore(restore_options);
      });
    });

  });
});