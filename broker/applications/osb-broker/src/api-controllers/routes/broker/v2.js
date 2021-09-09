'use strict';

const express = require('express');
const _ = require('lodash');
const config = require('@sf/app-config');
const middleware = require('../../middleware');
const { CONST } = require('@sf/common-utils');
const controller = require('../../').serviceBrokerApi;

const router = module.exports = express.Router({
  mergeParams: true
});
const instanceRouter = express.Router({
  mergeParams: true
});

/* Service Broker API Router */
router.use(middleware.basicAuth(config.username, config.password));
router.use(middleware.addRequestIdentityToResponse());

if (_.includes(['production', 'test'], process.env.NODE_ENV)) {
  router.use(controller.handler('apiVersion'));
}
router.route('/catalog')
  .get(controller.handler('getCatalog'))
  .all(middleware.methodNotAllowed(['GET']));
router.use('/service_instances/:instance_id', instanceRouter);
router.use(middleware.notFound());
router.use(middleware.error({
  defaultFormat: 'json'
}));

/* Service Instance Router */
instanceRouter.route('/')
  .put([middleware.isPlanDeprecated(), middleware.checkQuota(), middleware.validateInstanceRequest(), middleware.validateCreateRequest(), middleware.validateSchemaForRequest('service_instance', 'create'), middleware.validateMaintenanceInfoInRequest(), controller.handleWithResourceLocking('putInstance', CONST.OPERATION_TYPE.CREATE)])
  .patch([middleware.injectPlanInRequest(), middleware.validateContextUpdateFlag(), middleware.validateInstanceRequest(), middleware.validateSchemaForRequest('service_instance', 'update'), middleware.validateMaintenanceInfoInRequest(), middleware.checkQuota(), middleware.validateConcurrentOperations(), middleware.validateConcurrentBindingOperations(), controller.handleWithResourceLocking('patchInstance', CONST.OPERATION_TYPE.UPDATE)])
  .delete([middleware.validateInstanceRequest(), middleware.validateConcurrentOperations(), middleware.validateConcurrentBindingOperations(), controller.handleWithResourceLocking('deleteInstance', CONST.OPERATION_TYPE.DELETE)])
  .get([middleware.minApiVersion('2.14'), controller.handler('getServiceInstance')])
  .all(middleware.methodNotAllowed(['PUT', 'PATCH', 'DELETE', 'GET']));
instanceRouter.route('/last_operation')
  .get(middleware.validateLastOperationRequest(), controller.handler('getLastInstanceOperation'))
  .all(middleware.methodNotAllowed(['GET']));
instanceRouter.route('/service_bindings/:binding_id')
  .put([middleware.validateBindingRequest(), middleware.checkBlockingOperationInProgress(), middleware.validateSchemaForRequest('service_binding', 'create'), middleware.validateConcurrentOperations(), middleware.validateConcurrentBindingOperations(), controller.handler('putBinding')])
  .delete(middleware.validateBindingRequest(), middleware.checkBlockingOperationInProgress(), middleware.validateConcurrentOperations(), middleware.validateConcurrentBindingOperations(), controller.handler('deleteBinding'))
  .get([middleware.minApiVersion('2.14'), controller.handler('getServiceBinding')])
  .all(middleware.methodNotAllowed(['PUT', 'DELETE', 'GET']));
instanceRouter.route('/service_bindings/:binding_id/last_operation')
  .get(middleware.validateLastOperationRequest(), controller.handler('getLastBindingOperation'))
  .all(middleware.methodNotAllowed(['GET']));
