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

  removeFinalizersFromOSBResource(resourceType, resourceId, namespaceId, requestIdentity) {
    return eventmesh.apiServerClient.removeFinalizers({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
      resourceType: resourceType,
      resourceId: resourceId,
      namespaceId: namespaceId,
      finalizer: CONST.APISERVER.FINALIZERS.BROKER,
      requestIdentity: requestIdentity
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
        },
        requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
      }))
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getOSBResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            resourceId: getKubernetesName(req.params.instance_id),
            namespaceId: eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id)),
            start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            started_at: new Date(),
            requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
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
      started_at: new Date(),
      requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
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
            },
            requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
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
            },
            requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
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
            eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id)),
            _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
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
      resourceId: getKubernetesName(req.params.instance_id),
      requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
    })
      .then(() => eventmesh.apiServerClient.patchOSBResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
        resourceId: getKubernetesName(req.params.instance_id),
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.DELETE,
          description: ''
        },
        requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
      }))
      .then(() => {
        if (!plan.manager.async) {
          return eventmesh.apiServerClient.getOSBResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            resourceId: getKubernetesName(req.params.instance_id),
            namespaceId: eventmesh.apiServerClient.getNamespaceId(getKubernetesName(req.params.instance_id)),
            start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
            started_at: new Date(),
            requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
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

    function done(result) {
      const body = _.pick(result, 'state', 'description');
      if (body.state === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS ||
        body.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE ||
        body.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
        body.state = CONST.OPERATION.IN_PROGRESS;
      }
      if(_.get(operation, 'type') === 'update' && body.state === CONST.OPERATION.FAILED) {
        body.instance_usable = _.get(result, 'instanceUsable') === 'false' ||
        _.get(result, 'instanceUsable') === false ? false : true;

        body.update_repeatable = _.get(result, 'updateRepeatable') === 'false' ||
        _.get(result, 'updateRepeatable') === false ? false : true;

      }
      if(_.get(operation, 'type') === 'delete' && body.state === CONST.OPERATION.FAILED) {
        body.instance_usable = _.get(result, 'instanceUsable') === 'false' ||
        _.get(result, 'instanceUsable') === false ? false : true;
      }
      logger.debug('RequestIdentity:', _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent'), ',returning ..', body);
      return Promise.try(() => {
        if (_.get(operation, 'type') === 'delete' && body.state === CONST.OPERATION.SUCCEEDED && resourceGroup === CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR) {
          return this.removeFinalizersFromOSBResource(
            resourceType,
            resourceId,
            eventmesh.apiServerClient.getNamespaceId(resourceId),
            _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
          );
        }
      })
        .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send(body));
    }

    function failed(err) {
      res.status(CONST.HTTP_STATUS_CODE.OK).send({
        state: CONST.OPERATION.FAILED,
        description: `'${guid}' failed because "${err.message}"`
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
      namespaceId: resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES ? eventmesh.apiServerClient.getNamespaceId(resourceId) : undefined,
      requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
    })
      .tap(() => logger.debug(`RequestIdentity: ${_.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')} , Returning state of operation: ${operation.serviceflow_id}, ${resourceGroup}, ${resourceType}`))
      .then(done.bind(this))
      .catch(NotFound, notFound);
  }

  getLastBindingOperation(req, res) {
    const encodedOp = _.get(req, 'query.operation', undefined);
    const operation = encodedOp === undefined ? {} : decodeBase64(encodedOp);
    const guid = req.params.binding_id;
    const namespaceId = eventmesh.apiServerClient.getNamespaceId(req.params.instance_id);

    function done(result) {
      const body = _.pick(result, 'state', 'description');
      if (body.state === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS ||
        body.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE ||
        body.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
        body.state = CONST.OPERATION.IN_PROGRESS;
      }

      logger.debug('RequestIdentity:', _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent'), ',returning ..', body);
      return Promise.try(() => {
        if (_.get(operation, 'type') === 'delete' && body.state === CONST.OPERATION.SUCCEEDED && resourceGroup === CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR) {
          logger.debug(`Remove broker finalizer from ${resourceId}`);
          return this.removeFinalizersFromOSBResource(
            resourceType,
            resourceId,
            namespaceId,
            _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
          );
        }
      })
        .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send(body));
    }

    function failed(err) {
      res.status(CONST.HTTP_STATUS_CODE.OK).send({
        state: CONST.OPERATION.FAILED,
        description: `'${guid}' failed because "${err.message}"`
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
    const resourceGroup = CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR;
    const resourceType = CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS;
    const resourceId = getKubernetesName(req.params.binding_id);
    return eventmesh.apiServerClient.getLastOperation({
      resourceGroup: resourceGroup,
      resourceType: resourceType,
      resourceId: resourceId,
      namespaceId: namespaceId,
      requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
    })
      .tap(() => logger.debug(`RequestIdentity: ${_.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')} , Returning state of operation: ${resourceGroup}, ${resourceType}`))
      .then(done.bind(this))
      .catch(NotFound, notFound);
  }

  putBinding(req, res) {
    const params = _(req.body)
      .set('binding_id', getKubernetesName(req.params.binding_id))
      .set('id', req.params.binding_id)
      .set('instance_id', getKubernetesName(req.params.instance_id))
      .value();
    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    function done(bindResponse, state) {
      let response = decodeBase64(bindResponse);
      const statusCode = (state === CONST.APISERVER.RESOURCE_STATE.FAILED) ? CONST.HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR : CONST.HTTP_STATUS_CODE.CREATED;
      if(statusCode === CONST.HTTP_STATUS_CODE.CREATED && _.get(config, 'sendBindingMetadata', true) === false) {
        response = _.omit(response, 'metadata');
      }
      res.status(statusCode).send(response);
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
          },
          requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
        });
      })
      .then(() => {
        if (!plan.manager.asyncBinding) {
          return eventmesh.apiServerClient.getOSBResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
            resourceId: params.binding_id,
            namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id),
            start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            started_at: new Date(),
            timeout_in_sec: CONST.OSB_OPERATION.OSB_SYNC_OPERATION_TIMEOUT_IN_SEC,
            requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
          });
        }
      })
      .then(operationStatus => {
        if (plan.manager.asyncBinding) {
          const response = {};
          const statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
          response.operation = encodeBase64({
            'type': 'create'
          });
          res.status(statusCode).send(response);
        } else {
          const secretName = _.get(operationStatus, 'response.secretRef');
          const state = _.get(operationStatus, 'state');
          return eventmesh.apiServerClient.getSecret(secretName, eventmesh.apiServerClient.getNamespaceId(params.instance_id))
            .then(secret => done(secret.data.response, state));
        }
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
    const planId = params.plan_id;
    const plan = catalog.getPlan(planId);

    function done() {
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {};
      return Promise.try(() => {
        if (plan.manager.asyncBinding) {
          statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
          body.operation = encodeBase64({
            'type': 'delete'
          });
        } else {
          return this.removeFinalizersFromOSBResource(
            CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
            params.binding_id,
            eventmesh.apiServerClient.getNamespaceId(params.instance_id),
            _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
          );
        }
      })
        .then(() => res.status(statusCode).send(body));
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
      namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id),
      requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
    })
      .then(() => eventmesh.apiServerClient.updateOSBResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
        resourceId: params.binding_id,
        namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id),
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.DELETE
        },
        requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
      }))
      .then(() => {
        if (!plan.manager.asyncBinding) {
          return eventmesh.apiServerClient.getOSBResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
            resourceId: params.binding_id,
            namespaceId: eventmesh.apiServerClient.getNamespaceId(params.instance_id),
            start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
            started_at: new Date(),
            timeout_in_sec: CONST.OSB_OPERATION.OSB_SYNC_OPERATION_TIMEOUT_IN_SEC,
            requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
          });
        }
      })
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

  getServiceInstance(req, res) {
    function badRequest(err) {
      res.status(CONST.HTTP_STATUS_CODE.BAD_REQUEST).send({});
    }
    function notFound(err) {
      res.status(CONST.HTTP_STATUS_CODE.NOT_FOUND).send({});
    }
    function unprocessableEntity(err) {
      res.status(CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY).send({
        error: err.reason,
        description: err.message
      });
    }

    return Promise.try(() => {
      return eventmesh.apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
        resourceId: getKubernetesName(req.params.instance_id),
        requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
      })
        .then(resource => {
          const isServiceInstanceRetrievable = _.get(catalog.getService(_.get(resource, 'spec.serviceId')), 'instances_retrievable',false);
          // if service instance is not retrievable
          if(!isServiceInstanceRetrievable) {
            throw new BadRequest('Service does not support instance retrieval');
          }
          const resourceState = _.get(resource, 'status.state');
          // if resource state is enqueued or deleted.
          if(resourceState === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
            throw new NotFound('Service Instance not found');
          } else if(resourceState === CONST.APISERVER.RESOURCE_STATE.UPDATE) {
            // resource is being updated?
            throw new UnprocessableEntity('Service Instance is being updated and therefore cannot be fetched at this time', 'ConcurrencyError');
          } else if(resourceState === CONST.APISERVER.RESOURCE_STATE.DELETE) {
            // resource is being deleted?
            throw new UnprocessableEntity('Service Instance is being deleted and therefore cannot be fetched at this time', 'ConcurrencyError');
          } else if(resourceState === CONST.OPERATION.IN_PROGRESS || resourceState === CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS) {
            // check the last operation and send 422 accordingly.
            const lastOperation = _.get(resource, ['metadata','labels', CONST.APISERVER.LASTOPERATION_LABEL_KEY], '');

            if(lastOperation === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
              throw new NotFound('Service Instance not found');
            } else if(lastOperation === CONST.APISERVER.RESOURCE_STATE.UPDATE) {
              throw new UnprocessableEntity('Service Instance updation is in progress and therefore cannot be fetched at this time', 'ConcurrencyError');
            } else if(lastOperation === CONST.APISERVER.RESOURCE_STATE.DELETE) {
              throw new UnprocessableEntity('Service Instance deletion is in progress and therefore cannot be fetched at this time', 'ConcurrencyError');
            }
            throw new UnprocessableEntity(`Service Instance cannot be fetched:lastOperation: ${lastOperation}`, 'ConcurrencyError');
          } else if(resourceState === CONST.APISERVER.RESOURCE_STATE.SUCCEEDED || resourceState === CONST.APISERVER.RESOURCE_STATE.FAILED) {
            // return response with 200
            const body = {};
            // generate dashboard client
            const context = {};
            const plan = catalog.getPlan(_.get(resource, 'spec.planId'));
            _.set(context,'plan',plan);
            _.set(context,'instance_id',req.params.instance_id);
            const dashboardUrl = this.getDashboardUrl(context);
            if (dashboardUrl) {
              body.dashboard_url = dashboardUrl;
            }
            _.set(body,'service_id',_.get(resource, 'spec.serviceId'));
            _.set(body,'plan_id',_.get(resource, 'spec.planId'));
            
            if(_.has(resource, 'spec.metadata')) {
              _.set(body, 'metadata', _.get(resource, 'spec.metadata'));
            }

            if(!_.isEmpty(_.get(plan, 'metadata.retrievableParametersList', []))) {
              let paramList = _.get(plan, 'metadata.retrievableParametersList');
              if(_.isArray(paramList)) {
                let parameters = _.get(resource, 'spec.parameters');
                _.set(body,'parameters', _.pick(parameters, paramList));  
              }
            } else {
              _.set(body,'parameters',_.get(resource, 'spec.parameters'));
            }
            return res.status(CONST.HTTP_STATUS_CODE.OK).send(body);
          }
        })
        .catch(BadRequest, badRequest)
        .catch(NotFound, notFound)
        .catch(UnprocessableEntity, unprocessableEntity);

    });

  }

  getServiceBinding(req, res) {
    function badRequest(err) {
      res.status(CONST.HTTP_STATUS_CODE.BAD_REQUEST).send({});
    }
    function notFound(err) {
      res.status(CONST.HTTP_STATUS_CODE.NOT_FOUND).send({});
    }
    function done(bindResponse, body) {
      const response = decodeBase64(bindResponse);
      _.merge(body,response);
      res.status(CONST.HTTP_STATUS_CODE.OK).send(body);
    }

    return Promise.try(() => {
      return eventmesh.apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS,
        resourceId: req.params.binding_id,
        namespaceId: eventmesh.apiServerClient.getNamespaceId(req.params.instance_id),
        requestIdentity: _.get(req.headers, CONST.SF_BROKER_API_HEADERS.REQUEST_IDENTITY, 'Absent')
      })
        .then(resource => {
          const isServiceBindingRetrievable = _.get(catalog.getService(_.get(resource, 'spec.serviceId')), 'bindings_retrievable',false);
          const isServiceBindable = _.get(catalog.getService(_.get(resource, 'spec.serviceId')), 'bindable',false);
          // if service binding is not retrievable
          if(!isServiceBindingRetrievable) {
            throw new BadRequest('Service does not support binding retrieval');
          }
          const isPlanBindable = _.get(catalog.getPlan(_.get(resource, 'spec.planId')), 'bindable',isServiceBindable);
          // if plan is bindable
          if(!isPlanBindable) {
            throw new BadRequest('Service plan is not bindable');
          }
          const resourceState = _.get(resource, 'status.state');
          if(resourceState === CONST.APISERVER.RESOURCE_STATE.SUCCEEDED) {
            // return response with 200
            const body = {};
            _.set(body,'parameters',_.get(resource, 'spec.parameters'));

            const secretName = _.get(resource, 'status.response.secretRef');
            return eventmesh.apiServerClient.getSecret(secretName, eventmesh.apiServerClient.getNamespaceId(req.params.instance_id))
              .then(secret => done(secret.data.response, body));
          } else {
            throw new NotFound(`Service binding not found with status ${resourceState}`);
          }
        })
        .catch(BadRequest, badRequest)
        .catch(NotFound, notFound);

    });

  }

}

module.exports = ServiceBrokerApiController;
