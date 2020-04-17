'use strict';

const _ = require('lodash');
const logger = require('@sf/logger');
const {
  CONST,
  commonFunctions
} = require('@sf/common-utils');
const { catalog } = require('@sf/models');
const { apiServerClient } = require('@sf/eventmesh');
const Task = require('./Task');

class ServiceInstanceBackupTask extends Task {
  static run(taskId, taskDetails) {
    logger.info(`Running ServiceInstanceUpdateTask Task ${taskId} - with Data - ${JSON.stringify((taskDetails))}`);
    return commonFunctions.uuidV4()
      .then(backupGuid => {
        const planId = taskDetails.operation_params.plan_id;
        const plan = catalog.getPlan(planId);
        const params = _.cloneDeep(taskDetails.operation_params);
        const taskInfo = _.chain(taskDetails)
          .omit('operation_params')
          .merge()
          .value();
        params.parameters = _.merge(params.parameters, taskInfo);

        const backupOptions = {
          guid: backupGuid,
          instance_guid: taskDetails.instance_id,
          plan_id: planId,
          service_id: plan.service.id,
          arguments: params,
          username: taskDetails.user.name,
          useremail: taskDetails.user.email || '',
          context: params.context
        };

        return apiServerClient.createResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: backupGuid,
          labels: {
            instance_guid: taskDetails.instance_id
          },
          options: backupOptions,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            lastOperation: {},
            response: {}
          }
        })
          .tap(() => {
            logger.info(`Backup task ${taskDetails.task_description} with options -  ${JSON.stringify(backupOptions)} initiated successfully @ ${new Date()}`);
            taskDetails.resource = {
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
              resourceId: backupGuid
            };
            taskDetails.response = {
              description: `${taskDetails.task_description} initiated successfully @ ${new Date()}`
            };
          })
          .return(taskDetails);
      });
  }
}

module.exports = ServiceInstanceBackupTask;
