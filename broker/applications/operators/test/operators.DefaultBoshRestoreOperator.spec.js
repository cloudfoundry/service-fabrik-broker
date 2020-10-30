'use strict';

const DefaultBoshRestoreOperator = require('../src/bosh-restore-operator/DefaultBoshRestoreOperator');
const BoshRestoreService = require('../src/bosh-restore-operator/BoshRestoreService');
const BaseOperator = require('../src/BaseOperator');
const { CONST } = require('@sf/common-utils');
const { apiServerClient } = require('@sf/eventmesh');

describe('operators', function () {
  describe('DefaultBoshRestoreOperator', function () {
    const boshRestoreOperator = new DefaultBoshRestoreOperator();

    let sandbox, registerWatcherStub, registerCrdsStub;
    const restore_options = {
      plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
      service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
      context: {
        platform: 'cloudfoundry',
        organization_guid: 'c84c8e58-eedc-4706-91fb-e8d97b333481',
        space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
      },
      instance_guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
      deployment: 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa',
      arguments: {
        backup_guid: '071acb05-66a3-471b-af3c-8bbf1e4180be',
        backup: {
          type: 'online',
          secret: 'hugo'
        }
      },
      username: 'hugo'
    };
    before(function () {
      sandbox = sinon.createSandbox();
      registerWatcherStub = sandbox.stub(BaseOperator.prototype, 'registerWatcher');
      registerCrdsStub = sandbox.stub(BaseOperator.prototype, 'registerCrds').callsFake(() => Promise.resolve({}));
    });

    after(function () {
      sandbox.restore();
    });
    describe('#init', function () {
      it('should register watcher for restore resource', function () {
        const RESTORE_STATES = [
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_CREATE_DISK`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PUT_FILE`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_RUN_ERRANDS`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`,
          `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`
        ];
        const defaultValidStatelist = [
          CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
        ];
        const validStateList = defaultValidStatelist.concat(RESTORE_STATES);

        boshRestoreOperator.init()
          .then(() => {
            expect(registerCrdsStub.callCount).to.equal(1);
            expect(registerCrdsStub.calledWithExactly(
              CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
              CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BOSH_RESTORE
            )).to.equal(true);
            expect(registerWatcherStub.callCount).to.equal(1);
            expect(registerWatcherStub.firstCall.args[2]).to.deep.eql(validStateList);
          });
      });
    });

    describe('#processRequest', function () {
      it('should call processInQueueRequest for in_queue state and processInProgressRequest otherwise', () => {
        let processInQueueRequestStub = sandbox.stub(boshRestoreOperator, 'processInQueueRequest').resolves();
        let processInProgressRequestStub = sandbox.stub(boshRestoreOperator, 'processInProgressRequest').resolves();
        let dummyRequestObjectBody = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
          }
        };
        boshRestoreOperator.processRequest(dummyRequestObjectBody)
          .then(() => {
            expect(processInQueueRequestStub.callCount).to.eql(1);
            dummyRequestObjectBody.status.state = `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`;
            processInQueueRequestStub.restore();
          })
          .then(() => boshRestoreOperator.processRequest(dummyRequestObjectBody))
          .then(() => {
            expect(processInProgressRequestStub.callCount).to.eql(1);
            processInProgressRequestStub.restore();
          });
      });

      it('should handle the error in child calls', () => {
        let processInQueueRequestStub = sandbox.stub(boshRestoreOperator, 'processInQueueRequest');
        processInQueueRequestStub.rejects('Some error');
        let dummyRequestObjectBody = {
          spec: {
            options: JSON.stringify(restore_options)
          },
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
          },
          metadata: {
            name: 'dummy'
          }
        };
        let updateResourceStub = sandbox.stub(apiServerClient, 'updateResource');
        boshRestoreOperator.processRequest(dummyRequestObjectBody)
          .then(() => {
            expect(processInQueueRequestStub.callCount).to.eql(1);
            expect(updateResourceStub.callCount).to.eql(1);
            expect(updateResourceStub.firstCall.args[0].status.state).to.eql(CONST.APISERVER.RESOURCE_STATE.FAILED);
            processInQueueRequestStub.restore();
            updateResourceStub.restore();
          });
      });
    });

    describe('#processInQueueRequest', function () {
      it('should call startRestore with correct options', () => {
        const changeObject = {
          spec: {
            options: JSON.stringify(restore_options)
          }
        };
        let startRestoreStub = sandbox.stub(BoshRestoreService.prototype, 'startRestore').resolves();
        boshRestoreOperator.processInQueueRequest(changeObject)
          .then(() => {
            expect(startRestoreStub.callCount).to.eql(1);
            expect(startRestoreStub.firstCall.args[0]).to.deep.eql(restore_options);
            startRestoreStub.restore();
          });
      });
    });

    describe('#processInProgressRequest', function () {
      it('should call processInProgressRequest with correct options', () => {
        const changeObject = {
          spec: {
            options: JSON.stringify(restore_options)
          }
        };
        let processStateStub = sandbox.stub(BoshRestoreService.prototype, 'processState').resolves();
        boshRestoreOperator.processInProgressRequest(changeObject)
          .then(() => {
            expect(processStateStub.callCount).to.eql(1);
            expect(processStateStub.firstCall.args[0]).to.deep.eql(changeObject);
            processStateStub.restore();
          });
      });
    });
  });
});
