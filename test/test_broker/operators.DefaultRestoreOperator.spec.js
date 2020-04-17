'use strict';

const DefaultRestoreOperator = require('../../applications/operators/restore-operator/DefaultRestoreOperator');
const RestoreService = require('../../applications/operators/restore-operator/RestoreService');
const BaseOperator = require('../../applications/operators/BaseOperator');
const { CONST } = require('@sf/common-utils');
// const logger = require('../../common/logger');
// const apiserver = require('../../data-access-layer/eventmesh').apiServerClient;
const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
const restore_guid = 'd2e0a44a-9c6f-11e8-acf5-784f43900dff';
const restore_crd_prefix = '/apis/restore.servicefabrik.io/v1alpha1/namespaces/default/defaultrestore';


describe('operators', function () {
  describe('DefaultRestoreOperator', function () {

    const defaultRestoreOperator = new DefaultRestoreOperator();
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
    const changeObject = {
      metadata: {
        name: backup_guid,
        selfLink: `${restore_crd_prefix}/${restore_guid}`
      },
      spec: {
        options: JSON.stringify(restore_options)
      },
      status: {
        state: 'in_queue'
      }
    };

    let sandbox, registerWatcherStub, _processRestoreStub,
      startRestoreStub, registerCrdsStub, abortLastRestoreStub,
      _processAbortStub;

    before(function () {
      sandbox = sinon.createSandbox();
      registerWatcherStub = sandbox.stub(BaseOperator.prototype, 'registerWatcher');
      registerCrdsStub = sandbox.stub(BaseOperator.prototype, 'registerCrds').callsFake(() => Promise.resolve({}));
      abortLastRestoreStub = sandbox.stub(RestoreService.prototype, 'abortLastRestore').callsFake(() => Promise.resolve({}));
    });

    after(function () {
      sandbox.restore();
    });

    describe('#init', function () {
      it('should register watcher for restore resource', function () {
        defaultRestoreOperator.init()
          .then(() => {
            expect(registerCrdsStub.callCount).to.equal(1);
            expect(registerCrdsStub.calledWithExactly(
              CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
              CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE
            )).to.equal(true);
            expect(registerWatcherStub.callCount).to.equal(1);
            expect(registerWatcherStub.calledWithExactly(
              CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
              CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
              `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.OPERATION.ABORT},${CONST.APISERVER.RESOURCE_STATE.DELETE})`
            )).to.equal(true);
          });
      });
    });

    describe('#processRequest', function () {
      it('should start restore if state is in queue', () => {
        _processRestoreStub = sandbox.stub(DefaultRestoreOperator, '_processRestore');
        const fakeRequestObjectBody = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
          }
        };
        defaultRestoreOperator.processRequest(fakeRequestObjectBody);
        expect(_processRestoreStub.callCount).to.equal(1);
        expect(_processRestoreStub.calledWithExactly(fakeRequestObjectBody)).to.equal(true);
        _processRestoreStub.restore();
      });
      it('should start restore if state is in abort', () => {
        const fakeRequestObjectBody = {
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.ABORT
          }
        };
        _processAbortStub = sandbox.stub(DefaultRestoreOperator, '_processAbort');
        defaultRestoreOperator.processRequest(fakeRequestObjectBody);
        expect(_processAbortStub.callCount).to.equal(1);
        expect(_processAbortStub.calledWithExactly(fakeRequestObjectBody)).to.equal(true);
        _processAbortStub.restore();
      });
    });

    describe('#_processRestore', function () {
      it('should create manager and invoke startRestore', function () {
        startRestoreStub = sandbox.stub(RestoreService.prototype, 'startRestore');
        return DefaultRestoreOperator
          ._processRestore(changeObject)
          .then(() => {
            expect(startRestoreStub.callCount).to.equal(1);
            expect(startRestoreStub.firstCall.args[0].plan_id).to.equal(restore_options.plan_id);
            expect(startRestoreStub.calledWithExactly(restore_options)).to.equal(true);
            startRestoreStub.restore();
          });
      });
    });

    describe('#_processAbort', function () {
      it('should create manager and invoke abortLastRestore', function () {
        return DefaultRestoreOperator
          ._processAbort(changeObject)
          .then(() => {
            expect(abortLastRestoreStub.callCount).to.equal(1);
            expect(abortLastRestoreStub.calledWithExactly(restore_options)).to.equal(true);
          });
      });
    });

  });
});
