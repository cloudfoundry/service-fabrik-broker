'use strict';

const express = require('express');
const _ = require('lodash');
const config = require('../../config');
const middleware = require('../../middleware');
const common_middleware = require('../../../../common/middleware');
const controller = require('../../controllers').serviceBrokerApi;

const router = module.exports = express.Router({
  mergeParams: true
});
const instanceRouter = express.Router({
  mergeParams: true
});

/* Service Broker API Router */
router.use(common_middleware.basicAuth(config.username, config.password));
if (_.includes(['production', 'test'], process.env.NODE_ENV)) {
  router.use(controller.handler('apiVersion'));
}
router.route('/catalog')
  .get(controller.handler('getCatalog'))
  .all(common_middleware.methodNotAllowed(['GET']));
router.use('/service_instances/:instance_id', instanceRouter);
router.use(common_middleware.notFound());
router.use(common_middleware.error({
  defaultFormat: 'json'
}));

/* Service Instance Router */
instanceRouter.use(controller.handler('ensurePlatformContext'));
instanceRouter.use(controller.handler('assignInstance'));
instanceRouter.route('/')
  .put([middleware.isPlanDeprecated(), middleware.checkQuota(), controller.handler('putInstance')])
  .patch([middleware.checkQuota(), controller.handler('patchInstance')])
  .delete(controller.handler('deleteInstance'))
  .all(common_middleware.methodNotAllowed(['PUT', 'PATCH', 'DELETE']));
instanceRouter.route('/last_operation')
  .get(controller.handler('getLastInstanceOperation'))
  .all(common_middleware.methodNotAllowed(['GET']));
instanceRouter.route('/service_bindings/:binding_id')
  .put(controller.handler('putBinding'))
  .delete(controller.handler('deleteBinding'))
  .all(common_middleware.methodNotAllowed(['PUT', 'DELETE']));