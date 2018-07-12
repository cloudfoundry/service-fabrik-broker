'use strict';

const express = require('express');
const _ = require('lodash');
const config = require('../../../common/config');
const middleware = require('../../../broker/lib/middleware');
const commonMiddleware = require('../../../common/middleware');
const CONST = require('../../../common/constants');
const controller = require('../../').serviceBrokerApi;

const router = module.exports = express.Router({
  mergeParams: true
});
const instanceRouter = express.Router({
  mergeParams: true
});

/* Service Broker API Router */
router.use(commonMiddleware.basicAuth(config.username, config.password));
if (_.includes(['production', 'test'], process.env.NODE_ENV)) {
  router.use(controller.handler('apiVersion'));
}
router.route('/catalog')
  .get(controller.handler('getCatalog'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
router.use('/service_instances/:instance_id', instanceRouter);
router.use(commonMiddleware.notFound());
router.use(commonMiddleware.error({
  defaultFormat: 'json'
}));

/* Service Instance Router */
instanceRouter.use(controller.handler('ensurePlatformContext'));
instanceRouter.use(controller.handler('assignInstance'));
instanceRouter.route('/')
  .put([middleware.isPlanDeprecated(), middleware.checkQuota(), middleware.validateRequest(), middleware.validateCreateRequest(), controller.handleWithResourceLocking('putInstance', CONST.OPERATION_TYPE.CREATE)])
  .patch([middleware.checkQuota(), middleware.validateRequest(), controller.handleWithResourceLocking('patchInstance', CONST.OPERATION_TYPE.UPDATE)])
  .delete([middleware.validateRequest(), controller.handleWithResourceLocking('deleteInstance', CONST.OPERATION_TYPE.DELETE)])
  .all(commonMiddleware.methodNotAllowed(['PUT', 'PATCH', 'DELETE']));
instanceRouter.route('/last_operation')
  .get([middleware.lock(undefined, true), controller.handler('getLastInstanceOperation')]) //passing undefined as last operation operationType is part of the req
  .all(commonMiddleware.methodNotAllowed(['GET']));
instanceRouter.route('/service_bindings/:binding_id')
  .put([middleware.checkBlockingOperationInProgress(), controller.handler('putBinding')])
  .delete(middleware.checkBlockingOperationInProgress(), controller.handler('deleteBinding'))
  .all(commonMiddleware.methodNotAllowed(['PUT', 'DELETE']));