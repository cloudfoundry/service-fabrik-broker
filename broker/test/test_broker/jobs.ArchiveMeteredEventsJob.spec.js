'use strict';

const ArchiveMeteredEventsJob = require('../../core/scheduler-jobs/src/jobs/ArchiveMeteredEventsJob');
const { meteringArchiveStore } = require('@sf/iaas');
const { apiServerClient } = require('@sf/eventmesh');

describe('Jobs', () => {
  describe('ArchiveMeteredEventsJob', () => {
    const dummyMeteredEvents = [
      {
        'metadata': {
          'labels': {
            'event_type': 'create',
            'instance_guid': 'f4c513a4-d913-49a5-822e-cd763fe85206',
            'state': 'METERED'
          },
          'name': 'sfevent-1'
        },
        'status': {
          'state': 'METERED'
        }
      },
      {
        'metadata': {
          'labels': {
            'event_type': 'delete',
            'instance_guid': 'f4c513a4-d913-49a5-822e-cd763fe85206',
            'state': 'METERED'
          },
          'name': 'sfevent-2'
        },
        'status': {
          'state': 'METERED'
        }
      },
      {
        'metadata': {
          'labels': {
            'event_type': 'create',
            'instance_guid': '6b75cf42-a7a1-4fa0-a7f9-f5e900664f06',
            'state': 'METERED'
          },
          'name': 'sfevent-1'
        },
        'status': {
          'state': 'METERED'
        }
      }
    ];
    describe('run', () => {
      let sandbox, putArchiveFileStub, deleteResourceStub, patchEventToArchiveFileStub, getResourcesStub, runSucceededStub, runFailedStub;
      const job = {
        attrs: {
          name: 'ArchiveMeteredEvents',
          data: {
            'sleepDuration': 100,
            'deleteAttempts': 2
          }
        }
      };
      beforeEach(() => {
        sandbox = sinon.createSandbox();
        putArchiveFileStub = sandbox.stub(meteringArchiveStore, 'putArchiveFile');
        patchEventToArchiveFileStub = sandbox.stub(meteringArchiveStore, 'patchEventToArchiveFile');
        deleteResourceStub = sandbox.stub(apiServerClient, 'deleteResource');
        getResourcesStub = sandbox.stub(apiServerClient, 'getResources');
        runSucceededStub = sandbox.stub(ArchiveMeteredEventsJob, 'runSucceeded');
        runFailedStub = sandbox.stub(ArchiveMeteredEventsJob, 'runFailed');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('handles error in getMeteredEvents', () => {
        getResourcesStub.rejects('forced-exception');
        return ArchiveMeteredEventsJob.run(job, {})
          .then(() => {
            expect(getResourcesStub.callCount).to.eql(1);
            expect(runFailedStub.callCount).to.eql(1);
          });
      });
      it('returns if no metered events are found', () => {
        getResourcesStub.resolves([]);
        return ArchiveMeteredEventsJob.run(job, {})
          .then(() => {
            expect(getResourcesStub.callCount).to.eql(2);
            expect(runSucceededStub.callCount).to.eql(1);
          });
      });
      it('successfully processes metered events', () => {
        getResourcesStub.resolves(dummyMeteredEvents);
        putArchiveFileStub.resolves();
        patchEventToArchiveFileStub.resolves();
        deleteResourceStub.resolves();
        runSucceededStub.resolves();
        return ArchiveMeteredEventsJob.run(job, {})
          .then(() => {
            expect(getResourcesStub.callCount).to.eql(2);
            expect(runSucceededStub.callCount).to.eql(1);
            expect(putArchiveFileStub.callCount).to.eql(1);
            expect(patchEventToArchiveFileStub.callCount).to.eql(dummyMeteredEvents.length);
            expect(deleteResourceStub.callCount).to.eql(2*dummyMeteredEvents.length);
          });
      });
    });

    describe('patchToMeteringStore', () => {
      let sandbox, putArchiveFileStub, deleteResourceStub, patchEventToArchiveFileStub;
      beforeEach(() => {
        sandbox = sinon.createSandbox();
        putArchiveFileStub = sandbox.stub(meteringArchiveStore, 'putArchiveFile');
        patchEventToArchiveFileStub = sandbox.stub(meteringArchiveStore, 'patchEventToArchiveFile');
        deleteResourceStub = sandbox.stub(apiServerClient, 'deleteResource');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('processes events based on the config', () => {
        putArchiveFileStub.resolves();
        patchEventToArchiveFileStub.resolves();
        deleteResourceStub.resolves();
        return ArchiveMeteredEventsJob.patchToMeteringStore(dummyMeteredEvents, 'dummy-timestamp', 20)
          .then(eventsPatched => {
            expect(eventsPatched).to.eql(dummyMeteredEvents.length);
            expect(putArchiveFileStub.callCount).to.eql(1);
            expect(patchEventToArchiveFileStub.callCount).to.eql(dummyMeteredEvents.length);
            expect(deleteResourceStub.callCount).to.eql(dummyMeteredEvents.length);
          });
      });
      it('handles error while processing event', () => {
        putArchiveFileStub.resolves();
        patchEventToArchiveFileStub.rejects();
        return ArchiveMeteredEventsJob.patchToMeteringStore(dummyMeteredEvents, 'dummy-timestamp', 20)
          .catch(err => {
            expect(putArchiveFileStub.callCount).to.eql(1);
            expect(patchEventToArchiveFileStub.callCount).to.eql(1);
          });
      });
    });

    describe('processEvent', () => {
      let sandbox, patchEventToArchiveFileStub, deleteResourceStub;
      beforeEach(() => {
        sandbox = sinon.createSandbox();
        patchEventToArchiveFileStub = sandbox.stub(meteringArchiveStore, 'patchEventToArchiveFile');
        deleteResourceStub = sandbox.stub(apiServerClient, 'deleteResource');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('patches event to MeteringStore and deletes it from ApiServer', () => {
        patchEventToArchiveFileStub.resolves();
        deleteResourceStub.resolves();
        let dummyTimeStamp = 'dummyTimeStamp';
        return ArchiveMeteredEventsJob.processEvent(dummyMeteredEvents[0], dummyTimeStamp)
          .then(() => {
            expect(patchEventToArchiveFileStub.callCount).to.eql(1);
            expect(patchEventToArchiveFileStub.firstCall.args[0].metadata.name).to.eql('sfevent-1');
            expect(patchEventToArchiveFileStub.firstCall.args[1]).to.eql(dummyTimeStamp);
            expect(deleteResourceStub.callCount).to.eql(1);
          });
      });

      it('retries deleteResource call in case of failure', () => {
        patchEventToArchiveFileStub.resolves();
        deleteResourceStub.rejects('forced-exception');
        let dummyTimeStamp = 'dummyTimeStamp';
        return ArchiveMeteredEventsJob.processEvent(dummyMeteredEvents[0], dummyTimeStamp, 2)
          .catch(err => {
            expect(patchEventToArchiveFileStub.callCount).to.eql(1);
            expect(patchEventToArchiveFileStub.firstCall.args[0].metadata.name).to.eql('sfevent-1');
            expect(patchEventToArchiveFileStub.firstCall.args[1]).to.eql(dummyTimeStamp);
            expect(deleteResourceStub.callCount).to.eql(2);
          });
      });
    });
  });
});
