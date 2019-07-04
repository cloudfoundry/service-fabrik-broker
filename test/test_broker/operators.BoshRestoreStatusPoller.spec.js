'use strict';

const proxyquire = require('proxyquire');
const _ = require('lodash');
const CONST = require('../../common/constants');
const bosh = require('../../data-access-layer/bosh');
const eventmesh = require('../../data-access-layer/eventmesh');

class BaseStatusPoller {
    constructor(opts) {
    }
    clearPoller(intervalId) {
    }
}

const BoshRestoreStatusPoller = proxyquire('../../operators/bosh-restore-operator/BoshRestoreStatusPoller', {
    '../BaseStatusPoller': BaseStatusPoller
});

describe('operators', function() {
    describe('BoshRestoreStatusPoller', function() {
        const deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
        const restoreGuid = '2ed8d561-9eb5-11e8-a55f-784f43900dff';
        describe('#getStatus', function() {
            let sandbox;
            let stubs = [];
            let functions = ['processInProgressBoshStop', 'processInProgressAttachDisk', 'processInProgressBaseBackupErrand'
            , 'processInProgressPitrErrand', 'processInProgressBoshStart', 'processInProgressPostBoshStart'];
            beforeEach(() => {
                sandbox = sinon.createSandbox();
                _.forEach(functions, (fn) => {
                stubs.push(sandbox.stub(BoshRestoreStatusPoller.prototype, fn).resolves());
                });
            });
            afterEach(() => {
                sandbox.restore();
            });
            it('should handle the appropriate states', () => {
                const dummyPoller = new BoshRestoreStatusPoller();
                const RESTORE_POLLER_STATES = [
                    `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_STOP`,
                    `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_ATTACH_DISK`,
                    `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BASEBACKUP_ERRAND`,
                    `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_PITR_ERRAND`,
                    `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_BOSH_START`,
                    `${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS}_POST_BOSH_START`
                ];
                let restoreResource = {
                    metadata: {
                        name: restoreGuid
                    },
                    spec: {
                        options: {
                            restore_guid: restoreGuid
                        }
                    }
                };
                return Promise.map(RESTORE_POLLER_STATES, (state) => {
                    _.set(restoreResource, 'status.state', state);
                    return dummyPoller.getStatus(restoreResource, 'dummyIntervalId');
                })
                .then(() => {
                    _.forEach(stubs, (stub) => {
                        expect(stub.callCount).to.eql(1);
                    });
                });
            });

        });
        describe('#_handleBoshStartStopPolling', function() {
            let sandbox;
            let getTaskStub, patchResourceStub;
            let restoreMetadata = {
                'deploymentName': deploymentName
            };
            beforeEach(() => {
                sandbox = sinon.createSandbox();
                getTaskStub = sandbox.stub(bosh.director, 'getTask');
                patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
            });
            afterEach(() => {
                sandbox.restore();
            });
            it('should not perform any action when task is still in progress', () => {
                getTaskStub.resolves({state: 'processing'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    stateResults: {
                        'boshStop': {
                            'taskId': 'dummyTaskId'
                        }
                    },
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller._handleBoshStartStopPolling(restoreOptions, 'boshStop', 'nextState', 'errorMsg', 
                restoreGuid, 'dummyIntervalId')
                .then(() => {
                    expect(getTaskStub.callCount).to.eql(1);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId');
                    expect(patchResourceStub.callCount).to.eql(0);
                });
            });
            it('should sucessfully patch the next state when task is successful', () => {
                getTaskStub.resolves({state: 'done'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    stateResults: {
                        'boshStop': {
                            'taskId': 'dummyTaskId'
                        }
                    },
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller._handleBoshStartStopPolling(restoreOptions, 'boshStop', 'nextState', 'errorMsg', 
                restoreGuid, 'dummyIntervalId')
                .then(() => {
                    expect(getTaskStub.callCount).to.eql(1);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId');
                    expect(patchResourceStub.callCount).to.eql(1);
                    expect(patchResourceStub.firstCall.args[0].status.state).to.eql('nextState');
                });
            });
            it('should sucessfully patch the failure state when task is failed', () => {
                getTaskStub.resolves({state: 'errored'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    stateResults: {
                        'boshStop': {
                            'taskId': 'dummyTaskId'
                        }
                    },
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller._handleBoshStartStopPolling(restoreOptions, 'boshStop', 'nextState', 'errorMsg', 
                restoreGuid, 'dummyIntervalId')
                .catch(err => {
                    expect(getTaskStub.callCount).to.eql(1);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId');
                    expect(patchResourceStub.callCount).to.eql(1);
                    expect(patchResourceStub.firstCall.args[0].status.state).to.eql('failed');
                    expect(err.message).to.eql('errorMsg');
                });
            });
        }); 

        describe('#_handleErrandPolling', function() {
            let sandbox;
            let getTaskStub, patchResourceStub;
            let restoreMetadata = {
                'deploymentName': deploymentName
            };
            beforeEach(() => {
                sandbox = sinon.createSandbox();
                getTaskStub = sandbox.stub(bosh.director, 'getTask');
                patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
            });
            afterEach(() => {
                sandbox.restore();
            });
            it('should not perform any action when errand is still in progress', () => {
                getTaskStub.resolves({state: 'processing'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    stateResults: {
                        errands: {
                            'baseBackupErrand': {
                                'taskId': 'dummyTaskId'
                            }
                        }
                    },
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller._handleErrandPolling(restoreOptions, 'baseBackupErrand', 'nextState', 
                restoreGuid, 'dummyIntervalId')
                .then(() => {
                    expect(getTaskStub.callCount).to.eql(1);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId');
                    expect(patchResourceStub.callCount).to.eql(0);
                });
            });
            it('should update resource appropriately when the errand succeeds', () => {
                getTaskStub.resolves({state: 'done'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    stateResults: {
                        errands: {
                            'baseBackupErrand': {
                                'taskId': 'dummyTaskId'
                            }
                        }
                    },
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller._handleErrandPolling(restoreOptions, 'baseBackupErrand', 'nextState', 
                restoreGuid, 'dummyIntervalId')
                .then(() => {
                    expect(getTaskStub.callCount).to.eql(1);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId');
                    expect(patchResourceStub.callCount).to.eql(1);
                    expect(patchResourceStub.firstCall.args[0].status.state).to.eql('nextState');
                });
            });
            it('should throw error when the errand fails', () => {
                getTaskStub.resolves({state: 'errored'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    stateResults: {
                        errands: {
                            'baseBackupErrand': {
                                'taskId': 'dummyTaskId'
                            }
                        }
                    },
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller._handleErrandPolling(restoreOptions, 'baseBackupErrand', 'nextState', 
                restoreGuid, 'dummyIntervalId')
                .catch(err => {
                    expect(getTaskStub.callCount).to.eql(1);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId');
                    expect(patchResourceStub.callCount).to.eql(1);
                    expect(patchResourceStub.firstCall.args[0].status.state).to.eql('failed');
                    expect(err.message).to.eql('Errand baseBackupErrand failed as errored. Check task dummyTaskId');
                });
            });
            it('should handle the case when taskId for errand is not present', () => {
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    stateResults: {
                    },
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller._handleErrandPolling(restoreOptions, 'baseBackupErrand', 'nextState', 
                restoreGuid, 'dummyIntervalId')
                .then(() => {
                    expect(getTaskStub.callCount).to.eql(0);
                    expect(patchResourceStub.callCount).to.eql(1);
                    expect(patchResourceStub.firstCall.args[0].status.state).to.eql('nextState'); 
                });
            });
        });

        describe('#processInProgressAttachDisk', function() {
            let sandbox;
            let getTaskStub, patchResourceStub;
            let restoreMetadata = {
                'deploymentName': deploymentName,
                'deploymentInstancesInfo': [
                    {
                        attachDiskTaskId: 'dummyTaskId1'
                    },
                    {
                        attachDiskTaskId: 'dummyTaskId2'
                    },
                    {
                        attachDiskTaskId: 'dummyTaskId3'
                    }
                ]
            };
            beforeEach(() => {
                sandbox = sinon.createSandbox();
                getTaskStub = sandbox.stub(bosh.director, 'getTask');
                patchResourceStub = sandbox.stub(eventmesh.apiServerClient, 'patchResource');
            });
            afterEach(() => {
                sandbox.restore();
            });
            it('should correctly patch the resource when attach disk task is successful for all the instances', () => {
                getTaskStub.resolves({state: 'done'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller.processInProgressAttachDisk(restoreOptions, restoreGuid, 'dummyIntervalId')
                .then(() => {
                    expect(getTaskStub.callCount).to.eql(3);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId1');
                    expect(getTaskStub.secondCall.args[0]).to.eql('dummyTaskId2');
                    expect(getTaskStub.thirdCall.args[0]).to.eql('dummyTaskId3');
                    expect(patchResourceStub.callCount).to.eql(1);
                    expect(patchResourceStub.firstCall.args[0].status.state).to.eql(`in_progress_PUT_FILE`);    
                });
            });
            it('should not patch the resource when attach disk task is in progress for some of the instances', () => {
                getTaskStub.onFirstCall().resolves({state: 'done'});
                getTaskStub.onSecondCall().resolves({state: 'processing'});
                getTaskStub.onThirdCall().resolves({state: 'processing'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller.processInProgressAttachDisk(restoreOptions, restoreGuid, 'dummyIntervalId')
                .then(() => {
                    expect(getTaskStub.callCount).to.eql(3);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId1');
                    expect(getTaskStub.secondCall.args[0]).to.eql('dummyTaskId2');
                    expect(getTaskStub.thirdCall.args[0]).to.eql('dummyTaskId3');
                    expect(patchResourceStub.callCount).to.eql(0);
                });
            });
            it('should not patch the resource when attach disk task is failed for some of the instances', () => {
                getTaskStub.onFirstCall().resolves({state: 'done'});
                getTaskStub.onSecondCall().resolves({state: 'error'});
                getTaskStub.onThirdCall().resolves({state: 'done'});
                patchResourceStub.resolves();
                let restoreOptions = {
                    restoreMetadata: restoreMetadata,
                    restore_guid: restoreGuid
                };
                const dummyPoller = new BoshRestoreStatusPoller();
                return dummyPoller.processInProgressAttachDisk(restoreOptions, restoreGuid, 'dummyIntervalId')
                .catch(err => {
                    expect(getTaskStub.callCount).to.eql(3);
                    expect(getTaskStub.firstCall.args[0]).to.eql('dummyTaskId1');
                    expect(getTaskStub.secondCall.args[0]).to.eql('dummyTaskId2');
                    expect(getTaskStub.thirdCall.args[0]).to.eql('dummyTaskId3');
                    expect(patchResourceStub.callCount).to.eql(1);
                    expect(patchResourceStub.firstCall.args[0].status.state).to.eql('failed'); 
                    expect(err.message).to.eql('Attaching disk to some of the instances failed.');
                });
            });
        });
    });
});
