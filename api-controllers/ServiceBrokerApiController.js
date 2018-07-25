'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const errors = require('../common/errors');
const utils = require('../common/utils');
const catalog = require('../common/models/catalog');
const FabrikBaseController = require('./FabrikBaseController');
const lockManager = require('../data-access-layer/eventmesh').lockManager;
const AssertionError = assert.AssertionError;
const BadRequest = errors.BadRequest;
const PreconditionFailed = errors.PreconditionFailed;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const NotFound = errors.NotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ContinueWithNext = errors.ContinueWithNext;
const CONST = require('../common/constants');
const eventmesh = require('../data-access-layer/eventmesh');

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

    function done() {
      let statusCode = CONST.HTTP_STATUS_CODE.CREATED;
      const body = {
        dashboard_url: req.instance.dashboardUrl
      };
      if (req.instance.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        //body.operation = utils.encodeBase64(result);
      }
      res.status(statusCode).send(body);
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    req.operation_type = CONST.OPERATION_TYPE.CREATE;
    return Promise
      //.try(() => this.createDirectorService(req))
      //.then(directorService => directorService.create(params))
      .try(() => {
        const planId = params.plan_id;
        const plan = catalog.getPlan(planId);
        return eventmesh.apiServerClient.createResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: req.params.instance_id,
          parentResourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .then(() => {
        if (plan.manager.name === 'docker') {
          return eventmesh.apiServerClient.getResourceOperationStatus({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: plan.manager.name,
            resourceId: req.params.instance_id,
            start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            started_at: new Date()
          })
        }
      })
      .then(done)
      .catch(ServiceInstanceAlreadyExists, conflict);
  }

  patchInstance(req, res) {
    const params = _
      .chain(req.body)
      //.omit('plan_id', 'service_id')
      .cloneDeep()
      .value();
    //cloning here so that the DirectorInstance.update does not unset the 'service-fabrik-operation' from original req.body object

    function done(result) {
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {};
      if (req.instance.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        //body.operation = utils.encodeBase64(result);
      }
      res.status(statusCode).send(body);
    }

    req.operation_type = CONST.OPERATION_TYPE.UPDATE;

    return Promise
      .try(() => {
        if (!req.manager.isUpdatePossible(params.previous_values.plan_id)) {
          throw new BadRequest(`Update to plan '${req.manager.plan.name}' is not possible`);
        }
        //return this.createDirectorService(req);
      })

      //.then(directorService => directorService.update(params))
      //TODO : handle existing cases
      .then(() => {
        const planId = params.plan_id;
        const plan = catalog.getPlan(planId);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.UPDATE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .then(done);
  }

  deleteInstance(req, res) {
    const params = req.query;

    function done(result) {
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {};
      if (req.instance.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        //body.operation = utils.encodeBase64(result);
      }
      res.status(statusCode).send(body);
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }
    req.operation_type = CONST.OPERATION_TYPE.DELETE;

    return Promise
      // .try(() => this.createDirectorService(req))
      // .then(directorService => directorService.delete(params))
      .try(() => {
        const planId = params.plan_id;
        const plan = catalog.getPlan(planId);
        return eventmesh.apiServerClient.updateDeploymentResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
          resourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.DELETE,
            lastOperation: {},
            response: {}
          }
        });
      })
      .then(done)
      .catch(ServiceInstanceNotFound, gone);
  }
  getLastInstanceOperation(req, res) {
    // const encodedOp = _.get(req, 'query.operation', undefined);
    // const operation = encodedOp === undefined ? null : utils.decodeBase64(encodedOp);
    // const action = _.capitalize(operation.type);
    // const instanceType = req.instance.constructor.typeDescription;
    // const guid = req.instance.guid;

    function done(result) {
      const body = _.pick(result, 'state', 'description');
      // Unlock resource if state is succeeded or failed
      if (result.state === CONST.OPERATION.SUCCEEDED || result.state === CONST.OPERATION.FAILED) {
        return lockManager.unlock(req.params.instance_id)
          .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send(body));
      }
      res.status(CONST.HTTP_STATUS_CODE.OK).send(body);
    }

    function failed(err) {
      return lockManager.unlock(req.params.instance_id)
        .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send({
          state: CONST.OPERATION.FAILED,
          description: `${action} ${instanceType} '${guid}' failed because "${err.message}"`
        }));
    }

    function gone() {
      return lockManager.unlock(req.params.instance_id)
        .then(() => res.status(CONST.HTTP_STATUS_CODE.GONE).send({}));
    }

    function notFound(err) {
      //      if (operation.type === 'delete') {
      return gone();
      //      }
      //TODO : for non delete case, check when notfound is thrown and handle. similarly for AssertionError
      //      failed(err);
    }
    const planId = req.query.plan_id;
    const plan = catalog.getPlan(planId);
    return eventmesh.apiServerClient.getLastOperation({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: req.params.instance_id
      })
      .then(done)
      .catch(AssertionError, failed)
      .catch(NotFound, notFound);
  }

  putBinding(req, res) {
    const params = _(req.body)
      // .omit('plan_id', 'service_id')
      .set('binding_id', req.params.binding_id)
      .value();

    function done(credentials) {
      res.status(CONST.HTTP_STATUS_CODE.CREATED).send({
        credentials: credentials
      });
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    return Promise
      // .try(() => this.createDirectorService(req))
      // .then(directorService => directorService.delete(params))
      //TODO Handle docker resource also 
      .try(() => {
        const planId = params.plan_id;
        const plan = catalog.getPlan(planId);
        return eventmesh.apiServerClient.createOperation({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
          resourceId: params.binding_id,
          parentResourceId: req.params.instance_id,
          options: params,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE
          }
        });
      })
      .then(() => eventmesh.apiServerClient.getResourceOperationStatus({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
        resourceId: params.binding_id,
        start_state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
        started_at: new Date()
      }))
      .then(operationStatus => done(operationStatus.response))
      .catch(ServiceBindingAlreadyExists, conflict);
  }

  deleteBinding(req, res) {
    const params = _(req.query)
      // .omit('plan_id', 'service_id')
      .set('binding_id', req.params.binding_id)
      .value();

    function done() {
      res.status(CONST.HTTP_STATUS_CODE.OK).send({});
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }

    return Promise
      // .try(() => this.createDirectorService(req))
      // .then(directorService => directorService.delete(params))
      .try(() => {
        const planId = params.plan_id;
        const plan = catalog.getPlan(planId);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
          resourceId: params.binding_id,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.DELETE
          }
        });
      })
      .then(() => eventmesh.apiServerClient.getResourceOperationStatus({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
        resourceId: params.binding_id,
        start_state: CONST.APISERVER.RESOURCE_STATE.DELETE,
        started_at: new Date()
      }))
      .then(() => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
        resourceId: params.binding_id
      }))
      .then(done)
      .catch(NotFound, gone);
  }

}

module.exports = ServiceBrokerApiController;