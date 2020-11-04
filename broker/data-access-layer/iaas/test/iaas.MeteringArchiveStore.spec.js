'use strict';

const {
  meteringArchiveStore,
  cloudProvider
} = require('@sf/iaas');
const { CONST } = require('@sf/common-utils');

describe('iaas', () => {
  describe('meteringArchiveStore', () => {
    describe('putArchiveFile', () => {
      let sandbox, uploadJsonStub;
      beforeEach(() => {
        sandbox = sinon.createSandbox();
        uploadJsonStub = sandbox.stub(cloudProvider, 'uploadJson');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('creates a file based on timestamp provided', () => {
        uploadJsonStub.resolves();
        return meteringArchiveStore.putArchiveFile('dummy-timestamp')
          .then(() => {
            expect(uploadJsonStub.callCount).to.eql(1);
            const expectedFileName = `${CONST.METERING_ARCHIVE_ROOT_FOLDER}/${CONST.METERING_ARCHIVE_JOB_FILE_PREFIX}dummy-timestamp.json`;
            expect(uploadJsonStub.firstCall.args[0]).to.eql(expectedFileName);
            expect(uploadJsonStub.firstCall.args[1]).to.deep.eql({ 'meteredEvents':[] }); 
          });
      });
    });
    describe('patchEventToArchiveFile', () => {
      let sandbox, uploadJsonStub, downloadJsonStub;
      const dummyArchiveData = { 
        'meteredEvents':[
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
          }
        ] 
      };
      const newEvent = {
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
      };

      beforeEach(() => {
        sandbox = sinon.createSandbox();
        uploadJsonStub = sandbox.stub(cloudProvider, 'uploadJson');
        downloadJsonStub = sandbox.stub(cloudProvider, 'downloadJson');
      });
      afterEach(() => {
        sandbox.restore();
      });
      it('successfully patches new event to existing data in file', () => {
        uploadJsonStub.resolves();
        downloadJsonStub.resolves(dummyArchiveData);
        return meteringArchiveStore.patchEventToArchiveFile(newEvent, 'dummy-timestamp')
          .then(() => {
            expect(uploadJsonStub.callCount).to.eql(1);
            expect(downloadJsonStub.callCount).to.eql(1);
            const expectedFileName = `${CONST.METERING_ARCHIVE_ROOT_FOLDER}/${CONST.METERING_ARCHIVE_JOB_FILE_PREFIX}dummy-timestamp.json`;
            expect(uploadJsonStub.firstCall.args[0]).to.eql(expectedFileName);
            expect(uploadJsonStub.firstCall.args[1]).to.deep.eql(dummyArchiveData);
          });
      });
    });
  });
});
