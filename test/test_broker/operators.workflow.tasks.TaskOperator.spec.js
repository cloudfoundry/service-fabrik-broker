'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const BaseOperator = require('../../operators/BaseOperator');
const TaskFabrik = require('../../operators/workflow-operator/task/TaskFabrik');
const CONST = require('../../common/constants');
const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;

describe('operators', function () {
  describe('workflow', function () {
    describe('tasks', function () {
      describe('TaskOperator', function () {
        /* jshint expr:true */
        let TaskOperator, registerWatcherStub, registerCRDStub, updateResourceStub, clock;
        const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
        const task = TaskFabrik.getTask(CONST.APISERVER.TASK_TYPE.BLUEPRINT);
        const taskDetails = {
          operation_params: {
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
            parameters: {
              multi_az: true
            }
          },
          task_type: CONST.APISERVER.TASK_TYPE.BLUEPRINT,
          workflow_id: 'bc158c9a-7934-401e-94ab-057082abcde',
          workflow_name: 'upgrade_to_multi_az',
          task_description: 'TEST_TASK',
          instance_id: instance_id
        };
        const changeObject = {
          object: {
            metadata: {
              name: instance_id,
              selfLink: `/apis/workflow.servicefabrik.io/v1alpha1/namespaces/default/tasks/${instance_id}`
            },
            spec: {
              options: JSON.stringify(taskDetails)
            },
            status: {
              state: CONST.OPERATION.IN_PROGRESS
            }
          }
        };
        before(function () {
          registerWatcherStub = sinon.stub(BaseOperator.prototype, 'registerWatcher', () => Promise.resolve(true));
          registerCRDStub = sinon.stub(BaseOperator.prototype, 'registerCrds', () => Promise.resolve(true));
          TaskOperator = require('../../operators/workflow-operator/task/TaskOperator');
          updateResourceStub = sinon.stub(apiServerClient, 'updateResource', () => Promise.resolve(true));
          clock = sinon.useFakeTimers(new Date().getTime());
        });
        afterEach(function () {
          registerWatcherStub.reset();
          registerCRDStub.reset();
          updateResourceStub.reset();
        });
        after(function () {
          registerWatcherStub.restore();
          registerCRDStub.restore();
          clock.restore();
        });
        it('Initializes task operator successfully', () => {
          /* jshint unused:false */
          const to = new TaskOperator();
          return to.init()
            .then(() => {
              expect(registerCRDStub).to.be.calledOnce;
              expect(registerWatcherStub).to.be.calledTwice;

              const statesToWatchForTaskRun = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE];
              const statesToWatchForTaskStatus = [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS];

              expect(registerWatcherStub.firstCall.args[0]).to.equal(CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW);
              expect(registerWatcherStub.firstCall.args[1]).to.equal(CONST.APISERVER.RESOURCE_TYPES.TASK);
              expect(registerWatcherStub.firstCall.args[2]).to.eql(statesToWatchForTaskRun);

              expect(registerWatcherStub.secondCall.args[0]).to.equal(CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW);
              expect(registerWatcherStub.secondCall.args[1]).to.equal(CONST.APISERVER.RESOURCE_TYPES.TASK);
              expect(registerWatcherStub.secondCall.args[2]).to.eql(statesToWatchForTaskStatus);
              expect(typeof registerWatcherStub.secondCall.args[3]).to.equal('function');
              expect(registerWatcherStub.secondCall.args[4]).to.equal(CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL);
            });
        });
        it('process tsk successfully', () => {
          const to = new TaskOperator();
          return to
            .processRequest(changeObject.object)
            .then(() => {
              expect(updateResourceStub).to.be.calledOnce;
              expect(updateResourceStub.firstCall.args[0].status.state).to.equal(CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS);
              expect(updateResourceStub.firstCall.args[0].options.resource).to.eql({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
                resourceId: 'bp_task'
              });
            });
        });
        it('start status poller and complete the poller', () => {
          const to = new TaskOperator();
          return to.init()
            .then(() => to.startTaskStatusPoller(changeObject.object))
            .then((response) => {
              expect(response).to.equal(CONST.APISERVER.HOLD_PROCESSING_LOCK);
              expect(_.keys(to.pollers).length).to.equal(1);
              expect(_.keys(to.pollers)[0]).to.equal(instance_id);
              const pollStatusImpl = to.pollTaskStatus;

              const promiseResp = new Promise((resolve, reject) => {
                /* jshint unused:false */
                const pollStatusStub = sinon.stub(to, 'pollTaskStatus', (event, intervalId, task, taskDetails) => {
                  return pollStatusImpl.apply(to, [event, intervalId, task, taskDetails])
                    .then(resp => {
                      expect(resp).to.equal(true);
                      expect(updateResourceStub).to.be.calledTwice; //Once to update DONE status , Second time to release processing lock
                      expect(updateResourceStub.firstCall.args[0].status.state).to.equal(CONST.APISERVER.TASK_STATE.DONE);
                      clearInterval(intervalId);
                      resolve(true);
                    })
                    .catch((err) => {
                      console.log(err);
                      reject(false);
                    });
                });
              });
              clock.tick(CONST.APISERVER.WATCHER_REFRESH_INTERVAL);
              return promiseResp;
            });
        });
        describe('TaskPoller', function () {
          let getStatusStub;
          before(function () {
            getStatusStub = sinon.stub(task, 'getStatus');
            getStatusStub.returns(Promise.resolve({
              state: CONST.OPERATION.IN_PROGRESS,
              description: 'Blueprint Task succeeded!'
            }));
          });
          afterEach(function () {
            updateResourceStub.reset();
          });
          after(function () {
            getStatusStub.restore();
          });
          it('task poller continues when operation in progress', () => {
            const to = new TaskOperator();
            return to.init()
              .then(() => to.startTaskStatusPoller(changeObject.object))
              .then((response) => {
                expect(response).to.equal(CONST.APISERVER.HOLD_PROCESSING_LOCK);
                expect(_.keys(to.pollers).length).to.equal(1);
                expect(_.keys(to.pollers)[0]).to.equal(instance_id);
                const pollStatusImpl = to.pollTaskStatus;

                const promiseResp = new Promise((resolve, reject) => {
                  /* jshint unused:false */
                  const pollStatusStub = sinon.stub(to, 'pollTaskStatus', (event, intervalId, task, taskDetails) => {
                    return pollStatusImpl.apply(to, [event, intervalId, task, taskDetails])
                      .then(resp => {
                        expect(resp).to.equal(false);
                        //expect(updateResourceStub).to.be.calledOnce; //Continue to hold lock
                        expect(updateResourceStub.firstCall.args[0].metadata.annotations.lockedByManager).to.equal('10.0.2.2');
                        expect(new Date(updateResourceStub.firstCall.args[0].metadata.annotations.processingStartedAt).getTime()).to.equal(new Date().getTime());
                        clearInterval(intervalId);
                        resolve(true);
                      })
                      .catch((err) => {
                        console.log(err);
                        reject(err);
                      });
                  });
                });
                clock.tick(CONST.APISERVER.WATCHER_REFRESH_INTERVAL);
                return promiseResp;
              });
          });
        });
      });
    });
  });
});