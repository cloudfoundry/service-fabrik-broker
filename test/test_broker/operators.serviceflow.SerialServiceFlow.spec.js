'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const BaseOperator = require('../../operators/BaseOperator');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;
const utils = require('../../common/utils');

describe('operators', function () {
  describe('ServiceFlow', function () {
    describe('serialServiceFlow', function () {
      /* jshint expr:true */
      let SerialServiceFlowOperator, registerWatcherStub, registerCRDStub, updateResourceStub, createResourceStub, clock, utilsStub;
      let throwExceptionOnUpdate = false;
      const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
      const serviceflow_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfb';
      const task_id = `${serviceflow_id}.0`;

      const taskDetails = {
        operation_params: {
          plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
          parameters: {
            multi_az: true
          }
        },
        task_type: CONST.APISERVER.TASK_TYPE.BLUEPRINT,
        task_order: 1,
        serviceflow_id: serviceflow_id,
        serviceflow_name: CONST.SERVICE_FLOW.TYPE.BLUEPRINT_SERVICEFLOW,
        task_description: 'Void blueprint task',
        instance_id: instance_id
      };
      const taskObject = {
        object: {
          metadata: {
            name: task_id,
            selfLink: `/apis/serviceflow.servicefabrik.io/v1alpha1/namespaces/default/tasks/${task_id}`
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
      const serviceFlowOptions = {
        serviceflow_name: CONST.SERVICE_FLOW.TYPE.BLUEPRINT_SERVICEFLOW,
        instance_id: instance_id,
        operation_params: {
          parameters: {
            multi_az: true
          }
        }
      };
      const serviceFlowObject = {
        object: {
          metadata: {
            name: serviceflow_id,
            selfLink: `/apis/serviceflow.servicefabrik.io/v1alpha1/namespaces/default/serviceflows/${serviceflow_id}`
          },
          spec: {
            options: JSON.stringify(serviceFlowOptions)
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
        SerialServiceFlowOperator = require('../../operators/serviceflow-operator/SerialServiceFlowOperator');
        updateResourceStub = sinon.stub(apiServerClient, 'updateResource', () => {
          return Promise.try(() => {
            if (throwExceptionOnUpdate) {
              throw new errors.Conflict(`Task ${task_id} already exists`);
            }
            return Promise.resolve({
              body: {
                status: 200
              }
            });
          });
        });
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
      it('Initializes SerialServiceFlow operator successfully', () => {
        /* jshint unused:false */
        const serialServiceFlow = new SerialServiceFlowOperator();
        return serialServiceFlow.init()
          .then(() => {
            expect(registerCRDStub).to.be.calledOnce;
            expect(registerWatcherStub).to.be.calledTwice;

            const statesToWatchForServiceFlowExecution = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE];
            const statesToWatchForTaskRelay = [CONST.APISERVER.TASK_STATE.DONE];

            expect(registerWatcherStub.firstCall.args[0]).to.equal(CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW);
            expect(registerWatcherStub.firstCall.args[1]).to.equal(CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW);
            expect(registerWatcherStub.firstCall.args[2]).to.eql(statesToWatchForServiceFlowExecution);

            expect(registerWatcherStub.secondCall.args[0]).to.equal(CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW);
            expect(registerWatcherStub.secondCall.args[1]).to.equal(CONST.APISERVER.RESOURCE_TYPES.TASK);
            expect(registerWatcherStub.secondCall.args[2]).to.eql(statesToWatchForTaskRelay);
            expect(typeof registerWatcherStub.secondCall.args[3]).to.equal('function');
            expect(registerWatcherStub.secondCall.args[4]).to.equal(CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL);
          });
      });
      it('throws error for invalid service flow objects', () => {
        const serialServiceFlow = new SerialServiceFlowOperator();
        return serialServiceFlow
          .init()
          .then(() => serialServiceFlow.processRequest({
            metadata: {
              name: serviceflow_id
            },
            spec: {
              options: `{"serviceflow_id": "${serviceflow_id}", "serviceflow_name": "UNKNOWN_FLOW"}`
            }
          }))
          .then(() => {
            throw 'Method should have thrown BadRequest exception!';
          })
          .catch(errors.BadRequest, () => {
            const status = {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: `Invalid service flow UNKNOWN_FLOW. No service flow definition found!`
            };
            expect(updateResourceStub).to.be.calledOnce;
            expect(updateResourceStub.firstCall.args[0].status.state).to.equal(CONST.APISERVER.RESOURCE_STATE.FAILED);
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
              resourceId: serviceflow_id,
              status: {
                lastOperation: status,
                state: status.state
              }
            });
          });
      });
      it('initiate service flow successfully', () => {
        const serialServiceFlow = new SerialServiceFlowOperator();
        return serialServiceFlow
          .init()
          .then(() => serialServiceFlow.processRequest(serviceFlowObject.object))
          .then(() => {
            const serviceFlow = serialServiceFlow.SERVICE_FLOW_DEFINITION[CONST.SERVICE_FLOW.TYPE.BLUEPRINT_SERVICEFLOW];
            const tasks = serviceFlow.tasks;
            const status = {
              state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
              description: `${tasks[0].task_description} in progress @ ${new Date()}`
            };
            expect(createResourceStub).to.be.calledOnce;
            expect(createResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: `${serviceflow_id}.0`,
              labels: {
                serviceflow_id: serviceflow_id,
                task_order: '0'
              },
              options: _.merge(serviceFlowOptions, tasks[0], {
                task_order: 0,
                serviceflow_id: serviceflow_id
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
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
              resourceId: serviceflow_id,
              status: {
                lastOperation: status,
                state: status.state
              }
            });
          });
      });
      it('relay next task successfully on completion of a task run & service flow state is updated as complete', () => {
        const serialServiceFlow = new SerialServiceFlowOperator();
        return serialServiceFlow.init()
          .then(() => relayTaskCallBack(taskObject.object))
          .then(() => {
            expect(updateResourceStub).to.be.calledTwice;
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: task_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.SUCCEEDED,
                  response: {
                    state: CONST.OPERATION.SUCCEEDED,
                    description: ''
                  },
                  message: 'Last Task complete.'
                },
                response: {
                  state: CONST.OPERATION.SUCCEEDED,
                  description: ''
                },
                state: CONST.OPERATION.SUCCEEDED
              }
            });
            expect(updateResourceStub.secondCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
              resourceId: serviceflow_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.SUCCEEDED,
                  description: `Blueprint Service Flow succeeded @ ${new Date()}`
                },
                state: CONST.OPERATION.SUCCEEDED
              }
            });
          });
      });
      it('relay next task successfully on completion of a task run & update service flow state as in-progress', () => {
        const inProgressTask = _.cloneDeep(taskObject);
        const inProgressTaskDetails = _.cloneDeep(taskDetails);
        inProgressTaskDetails.task_order = 0;
        inProgressTask.object.spec.options = JSON.stringify(inProgressTaskDetails);
        const serialServiceFlow = new SerialServiceFlowOperator();
        return serialServiceFlow.init()
          .then(() => serialServiceFlow.relayTask(inProgressTask.object))
          .then(() => {
            expect(updateResourceStub).to.be.calledTwice;
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: `${serviceflow_id}.0`,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.SUCCEEDED,
                  response: {
                    state: CONST.OPERATION.SUCCEEDED,
                    description: ''
                  },
                  message: `Task complete and next relayed task is ${serviceflow_id}.1`
                },
                response: {
                  state: CONST.OPERATION.SUCCEEDED,
                  description: ''
                },
                state: CONST.OPERATION.SUCCEEDED
              }
            });
            expect(updateResourceStub.secondCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
              resourceId: serviceflow_id,
              status: {
                lastOperation: {
                  state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
                  description: `Void blueprint task is complete. Initiated Void blueprint task2 @ ${new Date()}`
                },
                state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
              }
            });
          });
      });
      it('relay next task is ignored if the same task was already relayed', () => {
        const inProgressTask = _.cloneDeep(taskObject);
        const inProgressTaskDetails = _.cloneDeep(taskDetails);
        inProgressTaskDetails.task_order = 0;
        inProgressTask.object.spec.options = JSON.stringify(inProgressTaskDetails);
        const serialServiceFlow = new SerialServiceFlowOperator();
        throwExceptionOnUpdate = true;
        return serialServiceFlow.init()
          .then(() => serialServiceFlow.relayTask(inProgressTask.object))
          .then(() => {
            throwExceptionOnUpdate = false;
            expect(updateResourceStub).to.be.calledOnce;
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: `${serviceflow_id}.0`,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.SUCCEEDED,
                  response: {
                    state: CONST.OPERATION.SUCCEEDED,
                    description: ''
                  },
                  message: `Task complete and next relayed task is ${serviceflow_id}.1`
                },
                response: {
                  state: CONST.OPERATION.SUCCEEDED,
                  description: ''
                },
                state: CONST.OPERATION.SUCCEEDED
              }
            });
          });
      });
      it('serial service flow stops if any task fails', () => {
        const failedTask = _.cloneDeep(taskObject);
        failedTask.object.status.response.state = CONST.OPERATION.FAILED;
        failedTask.object.status.response.description = 'Task Failed';
        const serialServiceFlow = new SerialServiceFlowOperator();
        return serialServiceFlow.init()
          .then(() => serialServiceFlow.relayTask(failedTask.object))
          .then(() => {
            expect(updateResourceStub).to.be.calledTwice;
            expect(updateResourceStub.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
              resourceId: task_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.FAILED,
                  response: {
                    state: CONST.OPERATION.FAILED,
                    description: 'Task Failed'
                  },
                  message: 'Task - Void blueprint task failed and service flow is also marked as failed.'
                },
                response: {
                  state: CONST.OPERATION.FAILED,
                  description: 'Task Failed'
                },
                state: CONST.OPERATION.FAILED
              }
            });
            expect(updateResourceStub.secondCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
              resourceId: serviceflow_id,
              status: {
                lastOperation: {
                  state: CONST.OPERATION.FAILED,
                  description: `Void blueprint task failed. ${failedTask.object.status.response.description}`
                },
                state: CONST.OPERATION.FAILED
              }
            });
          });
      });
    });
  });
});