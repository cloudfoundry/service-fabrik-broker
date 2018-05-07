'use strict';

const express = require('express');
const _ = require('lodash');
const config = require('../../config');
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
  .put([middleware.isPlanDeprecated(), middleware.checkQuota(), controller.handler('putInstance')])
  .patch([middleware.checkQuota(), controller.handler('patchInstance')])
  .delete(controller.handler('deleteInstance'))
  .all(commonMiddleware.methodNotAllowed(['PUT', 'PATCH', 'DELETE']));
instanceRouter.route('/last_operation')
  .get(controller.handler('getLastInstanceOperation'))
  .all(commonMiddleware.methodNotAllowed(['GET']));
instanceRouter.route('/service_bindings/:binding_id')
  .put(controller.handler('putBinding'))
  .delete(controller.handler('deleteBinding'))
  .all(commonMiddleware.methodNotAllowed(['PUT', 'DELETE']));