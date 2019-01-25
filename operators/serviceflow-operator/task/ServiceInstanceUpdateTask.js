'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const logger = require('../../../common/logger');
const CONST = require('../../../common/constants');
const catalog = require('../../../common/models/catalog');
const Task = require('./Task');
const apiServerClient = require('../../../data-access-layer/eventmesh').apiServerClient;

class ServiceInstanceUpdateTask extends Task {
  static run(taskId, taskDetails) {
    logger.info(`Running ServiceInstanceUpdateTask Task ${taskId} - with Data - ${JSON.stringify((taskDetails))}`);
    return Promise.try(() => {
      //TODO: Check if orgid/space guid is entitled to create multi-az deployment from CIS.
      return true;
      //Throw exception if not entitled.
    }).then(() => {
      const planId = taskDetails.operation_params.plan_id;
      const plan = catalog.getPlan(planId);
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
            resourceGroup: plan.manager.resource_mappings.resource_group,
            resourceType: plan.manager.resource_mappings.resource_type,
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