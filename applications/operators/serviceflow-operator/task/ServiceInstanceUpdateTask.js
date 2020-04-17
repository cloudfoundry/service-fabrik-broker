'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const logger = require('@sf/logger');
const { CONST } = require('@sf/common-utils');
const { apiServerClient } = require('@sf/eventmesh');
const Task = require('./Task');

class ServiceInstanceUpdateTask extends Task {
  static run(taskId, taskDetails) {
    logger.info(`Running ServiceInstanceUpdateTask Task ${taskId} - with Data - ${JSON.stringify((taskDetails))}`);
    return Promise.try(() => {
      // TODO: Check if orgid/space guid is entitled to create multi-az deployment from CIS.
      return true;
      // Throw exception if not entitled.
    }).then(() => {
      const params = _.cloneDeep(taskDetails.operation_params);
      const taskInfo = _.chain(taskDetails)
        .omit('operation_params')
        .merge()
        .value();
      params.parameters = _.merge(params.parameters, taskInfo);
      return apiServerClient.updateOSBResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
        resourceId: taskDetails.instance_id,
        spec: params,
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.UPDATE,
          description: ''
        }
      })
        .tap(() => {
          logger.info(`Update task ${taskDetails.task_description} with task data -  ${JSON.stringify(taskDetails.task_data)} initiated successfully @ ${new Date()}`);
          taskDetails.resource = {
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            resourceId: taskDetails.instance_id
          };
          taskDetails.response = {
            description: `${taskDetails.task_description} initiated successfully @ ${new Date()}`
          };
        })
        .return(taskDetails);
    });
  }
}

module.exports = ServiceInstanceUpdateTask;
