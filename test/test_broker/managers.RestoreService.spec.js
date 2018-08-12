'use strict';

const _ = require('lodash');
const catalog = require('../../common/models/catalog');
const RestoreService = require('../../managers/restore-manager/RestoreService');
const moment = require('moment');
const CONST = require('../../common/constants');
// const logger = require('../../common/logger');
const iaas = require('../../data-access-layer/iaas');
const backupStore = iaas.backupStore;

describe('managers', function () {
  describe('RestoreService', function () {

    function isoDate(time) {
      return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
    }

    let plan;
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const restoreGuid = '2ed8d561-9eb5-11e8-a55f-784f43900dff';
    const deployment_name = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    // const tenant_id = space_guid;
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    // const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
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
    const get_restore_opts = {
      type: 'update',
      deployment: 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
      context: {
        platform: 'cloudfoundry',
        organization_guid: 'c84c8e58-eedc-4706-91fb-e8d97b333481',
        space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
      },
      agent_ip: '10.244.10.160',
      instance_guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
      restore_guid: restoreGuid,
    };
    const restore_options = {
      restore_guid: restoreGuid,
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

    beforeEach(function () {
      plan = catalog.getPlan(plan_id);
      mocks.reset();
    });

    describe('#abortLastRestore', function () {
      it('should abort restore if state is processing', function () {
        mocks.cloudProvider.download(restorePathname, _
          .chain(restoreMetadata)
          .omit('state')
          .set('state', 'processing')
          .set('agent_ip', mocks.agent.ip)
          .value()
        );
        // mocks.cloudProvider.auth();
        // mocks.agent.getInfo();
        mocks.agent.abortRestore();
        mocks.apiServerEventMesh.nockPatchResourceRegex('backup', 'defaultrestore', {
          status: {
            state: 'aborting'
          }
        }, 1, body => {
          expect(body.status.state).to.eql('aborting');
          expect(body.status.response).to.be.an('undefined');
          return true;
        });
        return RestoreService.createService(plan)
          .then(rs => rs.abortLastRestore(restore_options))
          .then(() => mocks.verify());
      });
      it('should return state if state is not processing', function () {
        mocks.cloudProvider.download(restorePathname, _
          .chain(restoreMetadata)
          .omit('state')
          .set('state', 'succeeded')
          .value()
        );
        // mocks.cloudProvider.auth();
        return RestoreService.createService(plan)
          .then(rs => rs.abortLastRestore(restore_options))
          .then(() => mocks.verify());
      });
    });


    describe('#getLastRestore', function () {
      it('last opeation should download the restore logs and update the metadata', function () {
        const state = 'succeeded';
        const restoreState = {
          state: state,
          stage: 'Finished',
          updated_at: new Date(Date.now())
        };
        mocks.cloudProvider.download(restorePathname, {
          state: 'processing',
          'agent_ip': mocks.agent.ip
        });
        mocks.agent.lastRestoreOperation(restoreState);
        return RestoreService.createService(plan)
          .then(rs => rs.getLastRestore(space_guid, instance_id))
          .then(() => mocks.verify());
      });
    });

    describe('#getRestoreOperationState', function () {
      it('#getRestoreOperationState Should get restore state - processing', function () {
        const restoreState = {
          state: 'processing',
          stage: 'Restoring ...',
          updated_at: started_at
        };
        mocks.agent.lastRestoreOperation(restoreState);
        return RestoreService.createService(plan)
          .then(rs => rs.getRestoreOperationState(get_restore_opts))
          .then(() => mocks.verify());
      });

      it('should download the restore logs and update the metadata', function () {
        const state = 'succeeded';
        const restoreState = {
          state: state,
          stage: 'Finished',
          updated_at: new Date(Date.now())
        };
        const restoreLogs = [{
          time: '2015-11-18T11:28:40+00:00',
          level: 'info',
          msg: 'Downloading tarball ...'
        }, {
          time: '2015-11-18T11:28:42+00:00',
          level: 'info',
          msg: 'Extracting tarball ...'
        }];
        const restoreLogsStream = _
          .chain(restoreLogs)
          .map(JSON.stringify)
          .join('\n')
          .value();
        // mocks.agent.getInfo();
        // mocks.cloudProvider.auth();
        // mocks.uaa.getAccessToken();
        mocks.cloudProvider.download(restorePathname, {}, 2);
        mocks.agent.lastRestoreOperation(restoreState);
        mocks.agent.getRestoreLogs(restoreLogsStream);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.logs).to.eql(restoreLogs);
          expect(body.state).to.equal(state);
          expect(body.finished_at).to.not.be.undefined; // jshint ignore:line
          return true;
        });
        mocks.cloudProvider.headObject(restorePathname);
        mocks.serviceFabrikClient.scheduleBackup(instance_id, function (body) {
          return body.type === CONST.BACKUP.TYPE.ONLINE;
        });
        mocks.apiServerEventMesh.nockPatchResourceRegex(
          'backup',
          'defaultrestore', {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          'backup',
          'defaultrestore', {
            status: {
              state: CONST.OPERATION.IN_PROGRESS,
              response: '{"guid": "some_guid"}'
            }
          });
        return RestoreService.createService(plan)
          .then(rs => rs.getRestoreOperationState(get_restore_opts))
          .then(() => mocks.verify());
      });

      it('should download the restore logs and update the metadata - shoudn\'t schedule backup (duplicate check)  ', function () {
        const state = 'succeeded';
        const restoreState = {
          state: state,
          stage: 'Finished',
          updated_at: '2015-11-18T11:28:44Z'
        };
        const restoreLogs = [{
            time: '2015-11-18T11:28:40+00:00',
            level: 'info',
            msg: 'Downloading tarball ...'
          }, {
            time: '2015-11-18T11:28:42+00:00',
            level: 'info',
            msg: 'Extracting tarball ...'
          },
          {
            time: '2015-11-18T11:28:44+00:00',
            level: 'info',
            msg: 'Restore finished'
          }
        ];
        const restoreLogsStream = _
          .chain(restoreLogs)
          .map(JSON.stringify)
          .join('\n')
          .value();
        mocks.cloudProvider.download(restorePathname, _.assign(_.cloneDeep(restoreMetadata), {
          restore_dates: {
            succeeded: ['2015-11-18T11:28:44.000Z']
          }
        }), 2);
        // mocks.agent.getInfo();
        // mocks.cloudProvider.auth();
        // mocks.uaa.getAccessToken();
        mocks.agent.lastRestoreOperation(restoreState);
        mocks.agent.getRestoreLogs(restoreLogsStream);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.logs).to.eql(restoreLogs);
          expect(body.state).to.equal(state);
          expect(body.finished_at).to.not.be.undefined; // jshint ignore:line
          return true;
        });
        mocks.cloudProvider.headObject(restorePathname);
        mocks.apiServerEventMesh.nockPatchResourceRegex(
          'backup',
          'defaultrestore', {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          'backup',
          'defaultrestore', {
            status: {
              state: CONST.OPERATION.IN_PROGRESS,
              response: '{"guid": "some_guid"}'
            }
          });
        return RestoreService.createService(plan)
          .then(rs => rs.getRestoreOperationState(get_restore_opts))
          .then(() => mocks.verify());
      });

      it('should download the restore logs and update the metadata but don\'t schedule backup (failed restore)', function () {
        const state = 'failed';
        const restoreState = {
          state: state,
          stage: 'Finished',
          updated_at: new Date(Date.now())
        };
        const restoreLogs = [{
          time: '2015-11-18T11:28:40+00:00',
          level: 'info',
          msg: 'Downloading tarball ...'
        }, {
          time: '2015-11-18T11:28:42+00:00',
          level: 'info',
          msg: 'Extracting tarball error ...'
        }];
        const restoreLogsStream = _
          .chain(restoreLogs)
          .map(JSON.stringify)
          .join('\n')
          .value();
        mocks.cloudProvider.download(restorePathname, {}, 2);
        mocks.agent.lastRestoreOperation(restoreState);
        mocks.agent.getRestoreLogs(restoreLogsStream);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.logs).to.eql(restoreLogs);
          expect(body.state).to.equal(state);
          expect(body.finished_at).to.not.be.undefined; // jshint ignore:line
          return true;
        });
        mocks.cloudProvider.headObject(restorePathname);
        mocks.apiServerEventMesh.nockPatchResourceRegex(
          'backup',
          'defaultrestore', {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          'backup',
          'defaultrestore', {
            status: {
              state: CONST.OPERATION.IN_PROGRESS,
              response: '{"guid": "some_guid"}'
            }
          });
        return RestoreService.createService(plan)
          .then(rs => rs.getRestoreOperationState(get_restore_opts))
          .then(() => mocks.verify());
      });

      it('#getRestoreOperationState Should get restore state - succeeded', function () {
        const updated_at = new Date(Date.now());
        const restoreState = {
          state: 'succeeded',
          stage: 'Restoring ...',
          updated_at: updated_at
        };
        const restoreLogs = [{
          time: '2015-11-18T11:28:40+00:00',
          level: 'info',
          msg: 'Downloading tarball ...'
        }, {
          time: '2015-11-18T11:28:42+00:00',
          level: 'info',
          msg: 'Extracting tarball ...'
        }];
        const restoreLogsStream = _
          .chain(restoreLogs)
          .map(JSON.stringify)
          .join('\n')
          .value();
        // mocks.agent.getInfo();
        mocks.agent.lastRestoreOperation(restoreState);
        // mocks.cloudProvider.auth();
        // mocks.uaa.getAccessToken();
        mocks.agent.getRestoreLogs(restoreLogsStream);
        mocks.cloudProvider.download(restorePathname, {}, 2);
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.logs).to.eql(restoreLogs);
          expect(body.state).to.equal(CONST.OPERATION.SUCCEEDED);
          expect(body.finished_at).to.not.be.undefined; // jshint ignore:line
          return true;
        });
        mocks.cloudProvider.headObject(restorePathname);
        mocks.serviceFabrikClient.scheduleBackup(instance_id, function (body) {
          return body.type === CONST.BACKUP.TYPE.ONLINE;
        });
        mocks.apiServerEventMesh.nockPatchResourceRegex(
          'backup',
          'defaultrestore', {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          'backup',
          'defaultrestore', {
            status: {
              state: CONST.OPERATION.IN_PROGRESS,
              response: '{"guid": "some_guid"}'
            }
          });
        return RestoreService.createService(plan)
          .then(rs => rs.getRestoreOperationState(get_restore_opts))
          .then(() => mocks.verify());
      });
    });

  });
});