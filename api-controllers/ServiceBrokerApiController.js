'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const errors = require('../common/errors');
const logger = require('../common/logger');
const utils = require('../common/utils');
const catalog = require('../common/models/catalog');
const FabrikBaseController = require('./FabrikBaseController');
const BadRequest = errors.BadRequest;
const PreconditionFailed = errors.PreconditionFailed;
const NotFound = errors.NotFound;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ContinueWithNext = errors.ContinueWithNext;
const Conflict = errors.Conflict;
const CONST = require('../common/constants');
const eventmesh = require('../data-access-layer/eventmesh');
const config = require('../common/config');
const formatUrl = require('url').format;


class ServiceBrokerApiController extends FabrikBaseController {
  constructor() {
    super();
  }

  apiVersion(req, res) {
    /* jshint unused:false */
    const minVersion = CONST.SF_BROKER_API_VERSION_MIN;
    const version = _.get(req.headers, 'x-broker-api-version', '1.0');
    return Promise
      .try(() => {
        if (utils.compareVersions(version, minVersion) >= 0) {
          return;
        } else {
          throw new PreconditionFailed(`At least Broker API version ${minVersion} is required.`);
        }
      })
      .throw(new ContinueWithNext());
  }

  getCatalog(req, res) {
    /* jshint unused:false */
    res.status(CONST.HTTP_STATUS_CODE.OK).json(this.fabrik.getPlatformManager(req.params.platform).getCatalog(catalog));
  }

  putInstance(req, res) {
    const params = req.body;
    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    function getDashboardUrl(serviceId, planId, instanceId) {
      return formatUrl(_
        .chain(config.external)
        .pick('protocol', 'host')
        .set('slashes', true)
        .set('pathname', `/manage/instances/${serviceId}/${planId}/${instanceId}`)
        .value()
      );
    }

    function done() {
      let statusCode = CONST.HTTP_STATUS_CODE.CREATED;
      const body = {
        dashboard_url: getDashboardUrl(params.service_id, params.plan_id, req.params.instance_id)
      };
      if (plan.manager.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        body.operation = utils.encodeBase64({
          'type': 'create'
        });
      }
      res.status(statusCode).send(body);
    }

    function conflict() {
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    req.operation_type = CONST.OPERATION_TYPE.CREATE;
    return Promise
      .try(() => {
        return eventmesh.apiServerClient.createResource({
          resourceGroup: plan.manager.resource_mappings.resource_group,
          resourceType: plan.manager.resource_mappings.resource_type,
          resourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getResourceOperationStatus({
            resourceGroup: plan.manager.resource_mappings.resource_group,
            resourceType: plan.manager.resource_mappings.resource_type,
            resourceId: req.params.instance_id,
            start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            started_at: new Date()
          });
        }
      })
      .then(done)
      .catch(Conflict, conflict);
  }

  patchInstance(req, res) {
    const params = _
      .chain(req.body)
      .cloneDeep()
      .value();
    req.operation_type = CONST.OPERATION_TYPE.UPDATE;
    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    function done() {
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      let body = {};
      if (plan.manager.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        body.operation = utils.encodeBase64({
          'type': 'update'
        });
      }
      res.status(statusCode).send(body);
    }

    function isUpdatePossible(previousPlanId) {
      const previousPlan = _.find(plan.service.plans, ['id', previousPlanId]);
      return plan === previousPlan || _.includes(plan.manager.settings.update_predecessors, previousPlan.id);
    }
    return Promise
      .try(() => {
        if (!isUpdatePossible(params.previous_values.plan_id)) {
          throw new BadRequest(`Update to plan '${plan.name}' is not possible`);
        }
      })
      .then(() => {
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: plan.manager.resource_mappings.resource_group,
          resourceType: plan.manager.resource_mappings.resource_type,
          resourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.UPDATE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .catch(NotFound, () => {
        logger.info(`Resource resourceGroup: ${plan.manager.resource_mappings.resource_group},` +
          `resourceType: ${plan.manager.resource_mappings.resource_type}, resourceId: ${req.params.instance_id} not found, Creating now...`);
        return eventmesh.apiServerClient.createResource({
          resourceGroup: plan.manager.resource_mappings.resource_group,
          resourceType: plan.manager.resource_mappings.resource_type,
          resourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.UPDATE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getResourceOperationStatus({
            resourceGroup: plan.manager.resource_mappings.resource_group,
            resourceType: plan.manager.resource_mappings.resource_type,
            resourceId: req.params.instance_id,
            start_state: CONST.APISERVER.RESOURCE_STATE.UPDATE,
            started_at: new Date()
          });
        }
      })
      .then(done);
  }

  deleteInstance(req, res) {
    const params = req.query;
    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    function done() {
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {};
      if (plan.manager.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        body.operation = utils.encodeBase64({
          'type': 'delete'
        });
      }
      res.status(statusCode).send(body);
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }
    req.operation_type = CONST.OPERATION_TYPE.DELETE;

    return Promise
      .try(() => {
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: plan.manager.resource_mappings.resource_group,
          resourceType: plan.manager.resource_mappings.resource_type,
          resourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.DELETE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .catch(NotFound, () => {
        logger.info(`Resource resourceGroup: ${plan.manager.resource_mappings.resource_group},` +
          `resourceType: ${plan.manager.resource_mappings.resource_type}, resourceId: ${req.params.instance_id} not found, Creating now...`);
        return eventmesh.apiServerClient.createResource({
          resourceGroup: plan.manager.resource_mappings.resource_group,
          resourceType: plan.manager.resource_mappings.resource_type,
          resourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.DELETE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getResourceOperationStatus({
            resourceGroup: plan.manager.resource_mappings.resource_group,
            resourceType: plan.manager.resource_mappings.resource_type,
            resourceId: req.params.instance_id,
            start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
            started_at: new Date()
          });
        }
      })
      .then(done)
      .catch(NotFound, gone);
  }
  getLastInstanceOperation(req, res) {
    const encodedOp = _.get(req, 'query.operation', undefined);
    const operation = encodedOp === undefined ? null : utils.decodeBase64(encodedOp);
    const guid = req.params.instance_id;
    let action, instanceType;

    function done(result) {
      const body = _.pick(result, 'state', 'description');
      res.status(CONST.HTTP_STATUS_CODE.OK).send(body);
    }

    function failed(err) {
      res.status(CONST.HTTP_STATUS_CODE.OK).send({
        state: CONST.OPERATION.FAILED,
        description: `${action} ${instanceType} '${guid}' failed because "${err.message}"`
      });
    }

    function gone() {
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }

    function notFound(err) {
      if (_.get(operation, 'type') === 'delete') {
        return gone();
      }
      failed(err);
    }
    const planId = req.query.plan_id;
    const plan = catalog.getPlan(planId);
    return eventmesh.apiServerClient.getLastOperation({
        resourceGroup: plan.manager.resource_mappings.resource_group,
        resourceType: plan.manager.resource_mappings.resource_type,
        resourceId: req.params.instance_id
      })
      .then(done)
      .catch(NotFound, notFound);
  }

  putBinding(req, res) {
    const params = _(req.body)
      .set('binding_id', req.params.binding_id)
      .value();

    function done(encodedCredentials) {
      const credentials = utils.decodeBase64(encodedCredentials);
      res.status(CONST.HTTP_STATUS_CODE.CREATED).send({
        credentials: credentials
      });
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    return Promise
      .try(() => {
        return eventmesh.apiServerClient.createResource({
          resourceGroup: plan.manager.resource_mappings.bind.resource_group,
          resourceType: plan.manager.resource_mappings.bind.resource_type,
          resourceId: params.binding_id,
          labels: {
            instance_guid: req.params.instance_id
          },
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
          }
        });
      })
      .then(() => eventmesh.apiServerClient.getResourceOperationStatus({
        resourceGroup: plan.manager.resource_mappings.bind.resource_group,
        resourceType: plan.manager.resource_mappings.bind.resource_type,
        resourceId: params.binding_id,
        start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
        started_at: new Date()
      }))
      .then(operationStatus => done(operationStatus.response))
      .catch(ServiceBindingAlreadyExists, conflict);
  }

  deleteBinding(req, res) {
    const params = _(req.query)
      .set('binding_id', req.params.binding_id)
      .value();

    function done() {
      res.status(CONST.HTTP_STATUS_CODE.OK).send({});
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }
    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    return Promise
      .try(() => {
        return eventmesh.apiServerClient.updateResource({
            resourceGroup: plan.manager.resource_mappings.bind.resource_group,
            resourceType: plan.manager.resource_mappings.bind.resource_type,
            resourceId: params.binding_id,
            options: params,
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.DELETE
            }
          })
          .catch((NotFound), () => {
            logger.info(`Resource resourceGroup: ${plan.manager.resource_mappings.bind.resource_group},` +
              `resourceType: ${plan.manager.resource_mappings.bind.resource_type}, resourceId: ${params.binding_id} not found, Creating now...`);
            return eventmesh.apiServerClient.createResource({
              resourceGroup: plan.manager.resource_mappings.bind.resource_group,
              resourceType: plan.manager.resource_mappings.bind.resource_type,
              resourceId: params.binding_id,
              labels: {
                instance_guid: req.params.instance_id
              },
              options: params,
              status: {
                state: CONST.APISERVER.RESOURCE_STATE.DELETE,
                response: {}
              }
            });
          });
      })
      .then(() => eventmesh.apiServerClient.getResourceOperationStatus({
        resourceGroup: plan.manager.resource_mappings.bind.resource_group,
        resourceType: plan.manager.resource_mappings.bind.resource_type,
        resourceId: params.binding_id,
        start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
        started_at: new Date()
      }))
      .then(() => eventmesh.apiServerClient.deleteResource({
        resourceGroup: plan.manager.resource_mappings.bind.resource_group,
        resourceType: plan.manager.resource_mappings.bind.resource_type,
        resourceId: params.binding_id
      }))
      .then(done)
      .catch(NotFound, gone);
  }

}

module.exports = ServiceBrokerApiController;