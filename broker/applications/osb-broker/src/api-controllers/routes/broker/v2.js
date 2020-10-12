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
  .put([middleware.isPlanDeprecated(), middleware.checkQuota(), middleware.validateRequest(), middleware.validateCreateRequest(), middleware.validateSchemaForRequest('service_instance', 'create'), controller.handleWithResourceLocking('putInstance', CONST.OPERATION_TYPE.CREATE)])
  .patch([middleware.injectPlanInRequest(), middleware.checkQuota(), middleware.validateRequest(), middleware.validateSchemaForRequest('service_instance', 'update'), controller.handleWithResourceLocking('patchInstance', CONST.OPERATION_TYPE.UPDATE)])
  .delete([middleware.validateRequest(), controller.handleWithResourceLocking('deleteInstance', CONST.OPERATION_TYPE.DELETE)])
  .all(middleware.methodNotAllowed(['PUT', 'PATCH', 'DELETE']));
instanceRouter.route('/last_operation')
  .get(controller.handler('getLastInstanceOperation'))
  .all(middleware.methodNotAllowed(['GET']));
instanceRouter.route('/service_bindings/:binding_id')
  .put([middleware.checkBlockingOperationInProgress(), middleware.validateSchemaForRequest('service_binding', 'create'), controller.handler('putBinding')])
  .delete(middleware.checkBlockingOperationInProgress(), controller.handler('deleteBinding'))
  .all(middleware.methodNotAllowed(['PUT', 'DELETE']));
