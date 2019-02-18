'use strict';

const express = require('express');
const config = require('../config');
const middleware = require('../middleware');
require('../../../common/utils/enableAbsMatchingRouteLookup')(express);
const controller = require('../controllers').deploymentHook;
const router = module.exports = express.Router();
router.use(middleware.basicAuth(config.username, config.password));
router.route('/')
  .post(controller.handler('executeActions'))
  .all(middleware.methodNotAllowed(['POST']));

router.use(middleware.notFound());
router.use(middleware.error({
  defaultFormat: 'json'
}));
