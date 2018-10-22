'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const BaseOperator = require('../../operators/BaseOperator');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;
const utils = require('../../common/utils');

describe('operators', function () {
  describe('workflow', function () {
    describe('SerialWorkFlow', function () {
      /* jshint expr:true */
      let SerialWorkFlowOperator, registerWatcherStub, registerCRDStub, updateResourceStub, createResourceStub, clock, utilsStub;
      const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
      const workflow_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfb';
      const task_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfc';

      const taskDetails = {
        operation_params: {
          plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
          parameters: {
            multi_az: true
          }
        },
        task_type: CONST.APISERVER.TASK_TYPE.BLUEPRINT,
        task_order: 1,
        workflowId: workflow_id,
        workflow_name: CONST.WORKFLOW.TYPE.BLUEPRINT_WORKFLOW,
        task_description: 'Void blueprint task',
        instance_id: instance_id
      };
      const taskObject = {
        object: {
          metadata: {
            name: task_id,
            selfLink: `/apis/workflow.servicefabrik.io/v1alpha1/namespaces/default/tasks/${task_id}`
          },
          spec: {
            options: JSON.stringify(taskDetails)
          },
          status: {
            state: CONST.OPERATION.DONE,
            response: {
              state: CONST.OPERATION.SUCCEEDED
            },
            lastOperation: {
              state: CONST.OPERATION.SUCCEEDED
            }
          }
        }
      };
      const workflowOptions = {
        workflow_name: CONST.WORKFLOW.TYPE.BLUEPRINT_WORKFLOW,
        instance_id: instance_id,
        operation_params: {
          parameters: {
            multi_az: true
          }
        }
      };
      const workFLowObject = {
        object: {
          metadata: {
            name: workflow_id,
            selfLink: `/apis/workflow.servicefabrik.io/v1alpha1/namespaces/default/workflows/${workflow_id}`
          },
          spec: {
            options: JSON.stringify(workflowOptions)
          },
          status: {
            state: CONST.OPERATION.IN_QUEUE
          }
        }
      };
      let relayTaskCallBack;
      before(function () {
        registerWatcherStub = sinon.stub(BaseOperator.prototype, 'registerWatcher', (resourceGroup, resourceType, validStateList, handler) => {
          relayTaskCallBack = handler;
          Promise.resolve(true);
        });
        registerCRDStub = sinon.stub(BaseOperator.prototype, 'registerCrds', () => Promise.resolve(true));
        SerialWorkFlowOperator = require('../../operators/workflow-operator/SerialWorkFlowOperator');
        updateResourceStub = sinon.stub(apiServerClient, 'updateResource', () => Promise.resolve({
          body: {
            status: 200
          }
        }));
        createResourceStub = sinon.stub(apiServerClient, 'createResource', () => Promise.resolve(true));
        clock = sinon.useFakeTimers(new Date().getTime());
        utilsStub = sinon.stub(utils, 'uuidV4', () => Promise.resolve(task_id));
      });
      afterEach(function () {
        registerWatcherStub.reset();
        registerCRDStub.reset();
        createResourceStub.reset();
        updateResourceStub.reset();
        utilsStub.reset();
      });
      after(function () {
        registerWatcherStub.restore();
        registerCRDStub.restore();
        createResourceStub.restore();
        updateResourceStub.restore();
        utilsStub.restore();
        clock.restore();
      });
      it('Initializes SerialWorkFlow operator successfully', () => {
        /* jshint unused:false */
        const serialWorkFlow = new SerialWorkFlowOperator();
        return serialWorkFlow.init()
          .then(() => {
            expect(registerCRDStub).to.be.calledOnce;
            expect(registerWatcherStub).to.be.calledTwice;

            const statesToWatchForWorkflowExecution = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE];
            const statesToWatchForTaskRelay = [CONST.APISERVER.TASK_STATE.DONE];

            expect(registerWatcherStub.firstCall.args[0]).to.equal(CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW);
            expect(registerWatcherStub.firstCall.args[1]).to.equal(CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW);
            expect(registerWatcherStub.firstCall.args[2]).to.eql(statesToWatchForWorkflowExecution);

            expect(registerWatcherStub.secondCall.args[0]).to.equal(CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW);
            expect(registerWatcherStub.secondCall.args[1]).to.equal(CONST.APISERVER.RESOURCE_TYPES.TASK);
            expect(registerWatcherStub.secondCall.args[2]).to.eql(statesToWatchForTaskRelay);
            expect(typeof registerWatcherStub.secondCall.args[3]).to.equal('function');
            expect(registerWatcherStub.secondCall.args[4]).to.equal(CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL);
          });
      });
      it('throws error for invalid workflow objects', () => {
        const serialWorkFlow = new SerialWorkFlowOperator();
        return serialWorkFlow
          .init()
          .then(() => serialWorkFlow.processRequest({
            metadata: {
              name: instance_id
            },
            spec: {
              options: `{"workflowId": "${workflow_id}", "workflow_name": "UNKNOWN_FLOW"}`
            }
          }))
          .then(() => {
            throw 'Method should have thrown BadRequest exception!';
          })
          .catch(errors.BadRequest, () => {
            const status = {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: `Invalid workflow UNKNOWN_FLOW. No workflow definition found!`
            };
            expect(updateResourceStub).to.be.calledOnce;
            expect(updateResourceStub.firstCall.args[0].status.state).to.equal(CONST.APISERVER.RESOURCE_STATE.FAILED);
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
              resourceId: workflow_id,
              status: {
                lastOperation: status,
                state: status.state
              }
            });
          });
      });
      it('initiate workflow successfully', () => {
        const serialWorkFlow = new SerialWorkFlowOperator();
        return serialWorkFlow
          .init()
          .then(() => serialWorkFlow.processRequest(workFLowObject.object))
          .then(() => {
            const workflow = serialWorkFlow.WORKFLOW_DEFINITION[CONST.WORKFLOW.TYPE.BLUEPRINT_WORKFLOW];
            const tasks = workflow.tasks;
            const status = {
              state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
              description: `${tasks[0].task_description} in progress @ ${new Date()}`
            };
            expect(createResourceStub).to.be.calledOnce;
            expect(createResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: task_id,
              labels: {
                workflowId: workflow_id
              },
              options: _.merge(workflowOptions, tasks[0], {
                task_order: 0,
                workflowId: workflow_id
              }),
              status: {
                state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
                lastOperation: {},
                response: {}
              }
            });
            expect(updateResourceStub).to.be.calledOnce;
            expect(updateResourceStub.firstCall.args[0].status.state).to.equal(CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS);
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
              resourceId: workflow_id,
              status: {
                lastOperation: status,
                state: status.state
              }
            });
          });
      });
      it('relay next task successfully on completion of a task run & workflow state is updated as complete', () => {
        const serialWorkFlow = new SerialWorkFlowOperator();
        return serialWorkFlow.init()
          .then(() => relayTaskCallBack(taskObject.object))
          .then(() => {
            expect(updateResourceStub).to.be.calledTwice;
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: task_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.SUCCEEDED,
                  response: {
                    state: CONST.OPERATION.SUCCEEDED
                  },
                  message: 'Last Task complete.'
                },
                response: {
                  state: CONST.OPERATION.SUCCEEDED
                },
                state: CONST.OPERATION.SUCCEEDED
              }
            });
            expect(updateResourceStub.secondCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
              resourceId: workflow_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.SUCCEEDED,
                  description: `Blueprint Workflow completed @ ${new Date()}`
                },
                state: CONST.OPERATION.SUCCEEDED
              }
            });
          });
      });
      it('relay next task successfully on completion of a task run & update workflow state as in-progress', () => {
        const inProgressTask = _.cloneDeep(taskObject);
        const inProgressTaskDetails = _.cloneDeep(taskDetails);
        inProgressTaskDetails.task_order = 0;
        inProgressTask.object.spec.options = JSON.stringify(inProgressTaskDetails);
        const serialWorkFlow = new SerialWorkFlowOperator();
        return serialWorkFlow.init()
          .then(() => serialWorkFlow.relayTask(inProgressTask.object))
          .then(() => {
            expect(updateResourceStub).to.be.calledTwice;
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: task_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.SUCCEEDED,
                  response: {
                    state: CONST.OPERATION.SUCCEEDED
                  },
                  message: `Task complete and next relayed task is ${task_id}`
                },
                response: {
                  state: CONST.OPERATION.SUCCEEDED
                },
                state: CONST.OPERATION.SUCCEEDED
              }
            });
            expect(updateResourceStub.secondCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
              resourceId: workflow_id,
              status: {
                lastOperation: {
                  state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
                  description: `Void blueprint task completed @ ${new Date()}`
                },
                state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
              }
            });
          });
      });
      it('serial workflow stops if any task fails', () => {
        const failedTask = _.cloneDeep(taskObject);
        failedTask.object.status.response.state = CONST.OPERATION.FAILED;
        failedTask.object.status.response.description = 'Task Failed';
        const serialWorkFlow = new SerialWorkFlowOperator();
        return serialWorkFlow.init()
          .then(() => serialWorkFlow.relayTask(failedTask.object))
          .then(() => {
            expect(updateResourceStub).to.be.calledTwice;
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: task_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.FAILED,
                  response: {
                    state: CONST.OPERATION.FAILED,
                    description: 'Task Failed'
                  },
                  message: 'Task - Void blueprint task failed and workflow is also marked as failed.'
                },
                response: {
                  state: CONST.OPERATION.FAILED,
                  description: 'Task Failed'
                },
                state: CONST.OPERATION.FAILED
              }
            });
            expect(updateResourceStub.secondCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
              resourceId: workflow_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.FAILED,
                  description: `Void blueprint task failed - ${failedTask.object.status.response.description}`
                },
                state: CONST.OPERATION.FAILED
              }
            });
          });
      });
    });
  });
});