'use strict';

const express = require('express');
const config = require('../../config');
const middleware = require('../../middleware');
const controller = require('../../controllers').serviceBrokerApi;

const router = module.exports = express.Router({
  mergeParams: true
});
const instanceRouter = express.Router({
  mergeParams: true
});

/* Service Broker API Router */
router.use(middleware.basicAuth(config.username, config.password));
router.use(controller.handler('apiVersion'));
router.route('/catalog')
  .get(controller.handler('getCatalog'))
  .all(middleware.methodNotAllowed(['GET']));
router.use('/service_instances/:instance_id', instanceRouter);
router.use(middleware.notFound());
router.use(middleware.error({
  defaultFormat: 'json'
}));

/* Service Instance Router */
instanceRouter.use(controller.handler('assignInstance'));
instanceRouter.route('/')
  .put([middleware.isPlanDeprecated(), middleware.checkQuota(), controller.handler('putInstance')])
  .patch([middleware.checkQuota(), controller.handler('patchInstance')])
  .delete(controller.handler('deleteInstance'))
  .all(middleware.methodNotAllowed(['PUT', 'PATCH', 'DELETE']));
instanceRouter.route('/last_operation')
  .get(controller.handler('getLastInstanceOperation'))
  .all(middleware.methodNotAllowed(['GET']));
instanceRouter.route('/service_bindings/:binding_id')
  .put(controller.handler('putBinding'))
  .delete(controller.handler('deleteBinding'))
  .all(middleware.methodNotAllowed(['PUT', 'DELETE']));