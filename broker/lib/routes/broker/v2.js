'use strict';

const express = require('express');
const _ = require('lodash');
const config = require('../../config');
const CONST = require('../../constants');
const middleware = require('../../middleware');
const commonMiddleware = require('../../../../common/middleware');
const controller = require('../../controllers').serviceBrokerApi;

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
  .put([middleware.isPlanDeprecated(), middleware.checkQuota(), middleware.validateRequest(CONST.OPERATION_TYPE.CREATE), middleware.lock(CONST.OPERATION_TYPE.CREATE), controller.handler('putInstance')])
  .patch([middleware.checkQuota(), middleware.validateRequest(CONST.OPERATION_TYPE.UPDATE), middleware.lock(CONST.OPERATION_TYPE.UPDATE), controller.handler('patchInstance')])
  .delete([middleware.validateRequest(CONST.OPERATION_TYPE.DELETE), middleware.lock(CONST.OPERATION_TYPE.DELETE), controller.handler('deleteInstance')])
  .all(commonMiddleware.methodNotAllowed(['PUT', 'PATCH', 'DELETE']));
instanceRouter.route('/last_operation')
  .get([middleware.lock(undefined, true), controller.handler('getLastInstanceOperation')]) //passing undefined as last operation operationType is part of the req
  .all(commonMiddleware.methodNotAllowed(['GET']));
instanceRouter.route('/service_bindings/:binding_id')
  .put([middleware.isWriteLocked(), controller.handler('putBinding')])
  .delete(middleware.isWriteLocked(), controller.handler('deleteBinding'))
  .all(commonMiddleware.methodNotAllowed(['PUT', 'DELETE']));