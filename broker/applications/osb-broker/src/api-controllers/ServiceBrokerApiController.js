'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const formatUrl = require('url').format;
const logger = require('@sf/logger');
const config = require('@sf/app-config');
const eventmesh = require('@sf/eventmesh');
const {
  CONST,
  commonFunctions: {
    compareVersions,
    encodeBase64,
    decodeBase64,
    isValidKubernetesLabelValue,
    getKubernetesName
  },
  errors: {
    PreconditionFailed,
    NotFound,
    ContinueWithNext,
    Conflict,
    Timeout,
    UnprocessableEntity,
    BadRequest
  } } = require('@sf/common-utils');
const { catalog } = require('@sf/models');
const {
  FabrikBaseController
} = require('@sf/common-controllers');

class ServiceBrokerApiController extends FabrikBaseController {
  constructor() {
    super();
  }

  removeFinalizersFromOSBResource(resourceType, resourceId, namespaceId) {
    return eventmesh.apiServerClient.removeFinalizers({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
      resourceType: resourceType,
      resourceId: resourceId,
      namespaceId: namespaceId,
      finalizer: CONST.APISERVER.FINALIZERS.BROKER
    });
  }

  apiVersion(req, res) {
    /* jshint unused:false */
    const minVersion = CONST.SF_BROKER_API_VERSION_MIN;
    const version = _.get(req.headers, 'x-broker-api-version', '1.0');
    return Promise
      .try(() => {
        if (compareVersions(version, minVersion) >= 0) {
          return;
        } else {
          throw new PreconditionFailed(`At least Broker API version ${minVersion} is required.`);
        }
      })
      .throw(new ContinueWithNext());
  }

  getCatalog(req, res) {
    /* jshint unused:false */
    return Promise.try(() => {
      assert.ok(req.params.platform, 'Platform is must while fetching catalog');
      return _.get(config, 'apiserver.isServiceDefinitionAvailableOnApiserver') ? eventmesh.utils.loadCatalogFromAPIServer() : {};
    })
      .then(() => catalog.getCatalogForPlatform(req.params.platform))
      .then(servicePlans => res.status(CONST.HTTP_STATUS_CODE.OK).json(servicePlans));
  }

  putInstance(req, res) {
    const params = req.body;
    const planId = params.plan_id;
    const serviceId = params.service_id;
    const plan = catalog.getPlan(planId);
    const context = _
      .chain({})
      .merge(req.params, req.body)
      .set('plan', plan)
      .value();
    const contextLabels = _.pick(params.context, [
      'platform',
      'organization_guid',
      'space_guid',
      'origin',
      'subaccount_id'
    ]);
    _.set(params, 'instance_id', req.params.instance_id);

    function done(sfserviceinstance) {
      _.set(context, 'instance', sfserviceinstance);
      const dashboardUrl = this.getDashboardUrl(context);
      let statusCode = CONST.HTTP_STATUS_CODE.CREATED;
      const body = {};
      if (dashboardUrl) {
        body.dashboard_url = dashboardUrl;
      }
      if (plan.manager.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        body.operation = encodeBase64({
          'type': 'create'
        });
      }
      res.status(statusCode).send(body);
    }

    function conflict() {
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    let namespaceLabel = {};
    if (_.get(config, 'sf_namespace')) {
      namespaceLabel[CONST.APISERVER.NAMESPACE_LABEL_KEY] = _.get(config, 'sf_namespace');
    }

    const labels = _.mapValues(_.merge({
      plan_id: planId,
      service_id: serviceId
    }, contextLabels, namespaceLabel),
    value => _.trim(value));
    
    if(req.params.region) {
      _.set(labels,'region', req.params.region);
    }

    _.forIn(labels, function(value, key) {
      if (!isValidKubernetesLabelValue(value)) {
        throw new BadRequest(`Parameter ${key} value "${value}" must be a valid label value`);
      }
    });

    req.operation_type = CONST.OPERATION_TYPE.CREATE;
    return Promise.try(() => eventmesh.apiServerClient.createNamespace(eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id))))
      .then(() => eventmesh.apiServerClient.createOSBResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
        resourceId: getKubernetesName(req.params.instance_id),
        metadata: {
          finalizers: [`${CONST.APISERVER.FINALIZERS.BROKER}`]
        },
        labels: labels,
        spec: params,
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
        }
      }))
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getOSBResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            resourceId: getKubernetesName(req.params.instance_id),
            namespaceId: eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id)),
            start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            started_at: new Date()
          });
        }
      })
      .then(() => _.get(context, 'plan.manager.settings.dashboard_url_template') !== undefined ? eventmesh.apiServerClient.waitTillInstanceIsScheduled(getKubernetesName(req.params.instance_id)) : {})
      .then(done.bind(this))
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
    let serviceFlow;
    const context = _
      .chain({})
      .merge(req.params, req.body)
      .set('plan', plan)
      .value();

    function done(sfserviceinstance) {
      _.set(context, 'instance', sfserviceinstance);
      const dashboardUrl = this.getDashboardUrl(context);
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {
        dashboard_url: dashboardUrl
      };
      if (plan.manager.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        const operation = {
          'type': CONST.OPERATION_TYPE.UPDATE
        };
        if (serviceFlow !== undefined) {
          operation.serviceflow_name = serviceFlow.name;
          operation.serviceflow_id = serviceFlow.id;
        }
        body.operation = encodeBase64(operation);
      }
      res.status(statusCode).send(body);
    }

    const labels = req.params.region ? { 'region':req.params.region } : undefined;
    
    _.forIn(labels, function(value, key) {
      if (!isValidKubernetesLabelValue(value)) {
        throw new BadRequest(`Parameter ${key} value "${value}" must be a valid label value`);
      }
    });

    function isUpdatePossible(previousPlanId) {
      const previousPlan = _.find(plan.service.plans, ['id', previousPlanId]);
      return plan === previousPlan || _.includes(plan.manager.settings.update_predecessors, previousPlan.id);
    }
    let lastOperationState = {
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
      resourceId: getKubernetesName(req.params.instance_id),
      namespaceId: eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id)),
      start_state: CONST.APISERVER.RESOURCE_STATE.UPDATE,
      started_at: new Date()
    };
    return Promise
      .try(() => {
        if (!isUpdatePossible(params.previous_values.plan_id)) {
          throw new BadRequest(`Update to plan '${plan.name}' is not possible`);
        }
      })
      .then(() => {
        serviceFlow = req._serviceFlow;
        if (serviceFlow !== undefined) {
          assert.ok(serviceFlow.id, 'Service Flow Id is mandatory and must be set in BaseController');
          lastOperationState.resourceGroup = CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW;
          lastOperationState.resourceType = CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW;
          lastOperationState.namespaceId = undefined;
          const serviceFlowOptions = {
            serviceflow_name: serviceFlow.name,
            instance_id: req.params.instance_id,
            operation_params: params,
            user: req.user
          };
          return eventmesh.apiServerClient.createResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
            resourceId: getKubernetesName(serviceFlow.id),
            options: serviceFlowOptions,
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
              response: {}
            }
          });
        } else {
          _.set(params, 'instance_id', req.params.instance_id);
          return eventmesh.apiServerClient.patchOSBResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            resourceId: getKubernetesName(req.params.instance_id),
            labels: labels,
            spec: params,
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.UPDATE,
              description: ''
            }
          });
        }
      })
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getOSBResourceOperationStatus(lastOperationState);
        }
      })
      .then(() => _.get(context, 'plan.manager.settings.dashboard_url_template') !== undefined ? eventmesh.apiServerClient.waitTillInstanceIsScheduled(getKubernetesName(req.params.instance_id)) : {})
      .then(done.bind(this));
  }

  deleteInstance(req, res) {
    const params = req.query;
    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    function done() {
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {};
      return Promise.try(() => {
        if (plan.manager.async) {
          statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
          body.operation = encodeBase64({
            'type': 'delete'
          });
        } else {
          return this.removeFinalizersFromOSBResource(
            CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            getKubernetesName(req.params.instance_id),
            eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id))
          );
        }
      })
        .then(() => res.status(statusCode).send(body));
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }
    req.operation_type = CONST.OPERATION_TYPE.DELETE;
    // Delete resource before patching state to delete
    // As interoperator reacts on state change and deletionTimeStamp
    return eventmesh.apiServerClient.deleteResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
      resourceId: getKubernetesName(req.params.instance_id)
    })
      .then(() => eventmesh.apiServerClient.patchOSBResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
        resourceId: getKubernetesName(req.params.instance_id),
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.DELETE,
          description: ''
        }
      }))
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getOSBResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            resourceId: getKubernetesName(req.params.instance_id),
            namespaceId: eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id)),
            start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
            started_at: new Date()
          });
        }
      })
      .then(done.bind(this))
      .catch(NotFound, gone);
  }

  getLastInstanceOperation(req, res) {
    const encodedOp = _.get(req, 'query.operation', undefined);
    const operation = encodedOp === undefined ? {} : decodeBase64(encodedOp);
    const guid = req.params.instance_id;
    let action, instanceType;

    function done(result) {
      const body = _.pick(result, 'state', 'description');
      if (body.state === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS ||
        body.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
        body.state = CONST.OPERATION.IN_PROGRESS;
      }
      logger.debug('returning ..', body);
      return Promise.try(() => {
        if (_.get(operation, 'type') === 'delete' && body.state === CONST.OPERATION.SUCCEEDED && resourceGroup === CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR) {
          return this.removeFinalizersFromOSBResource(
            resourceType,
            resourceId,
            eventmesh.apiServerClient.getNamespaceId(resourceId)
          );
        }
      })
        .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send(body));
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
    const resourceGroup = operation.serviceflow_id ? CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW : CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR;
    const resourceType = operation.serviceflow_id ? CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW : CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES;
    const resourceId = getKubernetesName(operation.serviceflow_id ? operation.serviceflow_id : req.params.instance_id);
    return eventmesh.apiServerClient.getLastOperation({
      resourceGroup: resourceGroup,
      resourceType: resourceType,
      resourceId: resourceId,
      namespaceId: resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES ? eventmesh.apiServerClient.getNamespaceId(resourceId) : undefined
    })
      .tap(() => logger.debug(`Returning state of operation: ${operation.serviceflow_id}, ${resourceGroup}, ${resourceType}`))
      .then(done.bind(this))
      .catch(NotFound, notFound);
  }

  putBinding(req, res) {
    const params = _(req.body)
      .set('binding_id', getKubernetesName(req.params.binding_id))
      .set('id', req.params.binding_id)
      .set('instance_id', getKubernetesName(req.params.instance_id))
      .value();

    function done(bindResponse) {
      const response = decodeBase64(bindResponse);
      res.status(CONST.HTTP_STATUS_CODE.CREATED).send(response);
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    let namespaceLabel = {};
    if (_.get(config, 'sf_namespace')) {
      namespaceLabel[CONST.APISERVER.NAMESPACE_LABEL_KEY] = _.get(config, 'sf_namespace');
    }

    const labels = _.mapValues(_.merge({
      instance_guid: params.instance_id
    }, namespaceLabel),
    value => _.trim(value));

    _.forIn(labels, function(value, key) {
      if (!isValidKubernetesLabelValue(value)) {
        throw new BadRequest(`Parameter ${key} value "${value}" must be a valid label value`);
      }
    });

    return Promise
      .try(() => {
        return eventmesh.apiServerClient.createOSBResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
          resourceId: params.binding_id,
          metadata: {
            finalizers: [`${CONST.APISERVER.FINALIZERS.BROKER}`]
          },
          labels: labels,
          spec: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
          }
        });
      })
      .then(() => eventmesh.apiServerClient.getOSBResourceOperationStatus({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
        resourceId: params.binding_id,
        namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id),
        start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
        started_at: new Date(),
        timeout_in_sec: CONST.OSB_OPERATION.OSB_SYNC_OPERATION_TIMEOUT_IN_SEC
      }))
      .then(operationStatus => {
        const secretName = operationStatus.response.secretRef;
        return eventmesh.apiServerClient.getSecret(secretName, eventmesh.apiServerClient.getNamespaceId(params.instance_id))
          .then(secret => done(secret.data.response));
      })
      .catch(Conflict, conflict)
      .catch(Timeout, err => {
        res.status(CONST.HTTP_STATUS_CODE.TOO_MANY_REQUESTS).send({});
      });
  }

  deleteBinding(req, res) {
    const params = _(req.query)
      .set('binding_id', getKubernetesName(req.params.binding_id))
      .set('id', req.params.binding_id)
      .set('instance_id', getKubernetesName(req.params.instance_id))
      .value();

    function done() {
      return this.removeFinalizersFromOSBResource(
        CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
        params.binding_id,
        eventmesh.apiServerClient.getNamespaceId(params.instance_id)
      )
        .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send({}));
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }
    // Delete resource before patching state to delete
    // As interoperator reacts on state change and deletionTimeStamp
    return eventmesh.apiServerClient.deleteResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
      resourceId: params.binding_id,
      namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id)
    })
      .then(() => eventmesh.apiServerClient.updateOSBResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
        resourceId: params.binding_id,
        namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id),
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.DELETE
        }
      }))
      .then(() => eventmesh.apiServerClient.getOSBResourceOperationStatus({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
        resourceId: params.binding_id,
        namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id),
        start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
        started_at: new Date(),
        timeout_in_sec: CONST.OSB_OPERATION.OSB_SYNC_OPERATION_TIMEOUT_IN_SEC
      }))
      .then(done.bind(this))
      .catch(NotFound, gone)
      .catch(Timeout, err => {
        res.status(CONST.HTTP_STATUS_CODE.TOO_MANY_REQUESTS).send({});
      });
  }

  getDashboardUrl(context) {
    if (_.get(context, 'plan.manager.settings.dashboard_url_template') !== undefined) {
      const urlTemplate = new Buffer(context.plan.manager.settings.dashboard_url_template, 'base64');
      const dashboardUrl = encodeURI(_.template(urlTemplate)(context));
      if (CONST.REGEX_PATTERN.URL.test(dashboardUrl)) {
        return dashboardUrl;
      }
      throw new UnprocessableEntity(`Unable to generate valid dashboard URL with the template '${urlTemplate}'`);
    } else if (_.get(config, 'external.protocol') !== undefined && _.get(config, 'external.host') !== undefined) {
      return formatUrl(_
        .chain(config.external)
        .pick('protocol', 'host')
        .set('slashes', true)
        .set('pathname', `manage/dashboards/${context.plan.manager.name}/instances/${context.instance_id}`)
        .value()
      );
    } else {
      return null;
    }
  }
}

module.exports = ServiceBrokerApiController;
