'use strict';

const _ = require('lodash');
const {
  catalog,
  Service
} = require('@sf/models');
const RestoreService = require('../../applications/operators/src/restore-operator/RestoreService');
const moment = require('moment');
const config = require('@sf/app-config');
const { CONST } = require('@sf/common-utils');
const { backupStore } = require('@sf/iaas');

describe('operators', function () {
  describe('RestoreService', function () {

    function isoDate(time) {
      return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
    }

    let plan;
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const restoreGuid = '2ed8d561-9eb5-11e8-a55f-784f43900dff';
    const deployment_name = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const time = Date.now();
    const agent_ip = '10.244.10.160';
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
        succeeded: [
          moment(time).subtract(2, 'days').toDate().toISOString(),
          moment(time).subtract(40, 'days').toDate().toISOString()
        ]
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
      agent_ip: agent_ip,
      instance_guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
      restore_guid: restoreGuid
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
        backup_guid: backup_guid,
        backup: {
          type: 'online',
          secret: 'fakeSecret'
        }
      },
      username: username
    };
    const dummyDeploymentResource = {
      metadata: {
        annotations: {
          labels: 'dummy'
        }
      }
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
        mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
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

    describe('#startRestore', function () {
      it('should start restore', function () {
        mocks.director.getDeploymentVms(deployment_name);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
        mocks.director.getDeploymentInstances(deployment_name);
        mocks.director.getDeployments();
        mocks.agent.getInfo();
        // mocks.agent.getInfo();
        // mocks.cloudProvider.auth();
        mocks.agent.startRestore();
        mocks.cloudProvider.upload(restorePathname, body => {
          expect(body.state).to.equal(CONST.RESTORE_OPERATION.PROCESSING);
          expect(body.finished_at).to.not.be.undefined; // jshint ignore:line
          return true;
        });
        mocks.cloudProvider.headObject(restorePathname);
        mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {}, 1, body => {
          const responseObj = JSON.parse(body.status.response);
          expect(responseObj.service_id).to.eql(service_id);
          expect(responseObj.plan_id).to.eql(plan_id);
          expect(responseObj.instance_guid).to.eql(instance_id);
          expect(responseObj.username).to.eql(username);
          expect(responseObj.operation).to.eql(CONST.OPERATION_TYPE.RESTORE);
          expect(responseObj.backup_guid).to.eql(backup_guid);
          expect(responseObj.state).to.eql(CONST.RESTORE_OPERATION.PROCESSING);
          expect(responseObj.agent_ip).to.eql(agent_ip);
          // expect(responseObj.started_at).to.eql(started_at);
          expect(responseObj.finished_at).to.eql(null);
          expect(responseObj.tenant_id).to.eql(space_guid);
          // expect(responseObj.restore_dates).to.eql('fillin');
          // expect(responseObj.stage).to.eql('fillin');
          return true;
        });
        return RestoreService.createService(plan)
          .then(rs => rs.startRestore(restore_options))
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
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
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
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
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
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
            status: {
              state: CONST.OPERATION.IN_PROGRESS,
              response: '{"guid": "some_guid"}'
            }
          });
        return RestoreService.createService(plan)
          .then(rs => rs.getRestoreOperationState(get_restore_opts))
          .then(() => mocks.verify());
      });

      describe('#non-pitr-services:', function () {
        const indexOfService = _.findIndex(config.services, service => service.pitr === true);
        const non_pitr_plan_id = 'b715f834-2048-11e7-a560-080027afc1e6';
        const non_pitr_service_id = '19f17a7a-5247-4ee2-94b5-03eac6756388';
        const nonPitrRestorePrefix = `${space_guid}/restore/${non_pitr_service_id}.${instance_id}`;
        const nonPitrRestoreFilename = `${nonPitrRestorePrefix}.json`;
        const nonPitrRestorePathname = `/${container}/${nonPitrRestoreFilename}`;
        let getServiceStub;
        before(function () {
          config.services[indexOfService].pitr = false;
          getServiceStub = sinon.stub(catalog, 'getService');
          getServiceStub.withArgs(config.services[indexOfService].id).returns(new Service(config.services[indexOfService]));
        });
        after(function () {
          config.services[indexOfService].pitr = true;
        });
        this.afterEach(function () {
          getServiceStub.restore();
        });
        it('should download the restore logs and update the metadata - and shouldn\'t schedule backup - Non PITR service', function () {
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
          // mocks.cloudProvider.auth();
          // mocks.agent.getInfo();
          mocks.cloudProvider.download(nonPitrRestorePathname, {}, 2);
          mocks.agent.lastRestoreOperation(restoreState);
          mocks.agent.getRestoreLogs(restoreLogsStream);
          mocks.cloudProvider.upload(nonPitrRestorePathname, body => {
            expect(body.logs).to.eql(restoreLogs);
            expect(body.state).to.equal(state);
            expect(body.finished_at).to.not.be.undefined; // jshint ignore:line
            return true;
          });
          mocks.cloudProvider.headObject(nonPitrRestorePathname);
          let non_pitr_plan = catalog.getPlan(non_pitr_plan_id);
          mocks.apiServerEventMesh.nockPatchResourceRegex(
            CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {});
          mocks.apiServerEventMesh.nockGetResourceRegex(
            CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
              status: {
                state: CONST.OPERATION.IN_PROGRESS,
                response: '{"guid": "some_guid"}'
              }
            });
          return RestoreService.createService(non_pitr_plan)
            .then(rs => rs.getRestoreOperationState(get_restore_opts))
            .then(res => {
              expect(res.state).to.equal(state);
              expect(res).to.have.property('stage');
              mocks.verify();
            })
            .then(() => mocks.verify());
        });
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
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {});
        mocks.apiServerEventMesh.nockGetResourceRegex(
          CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
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
