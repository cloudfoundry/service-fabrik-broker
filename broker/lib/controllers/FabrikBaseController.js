'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const BaseController = require('../../../common/controllers/BaseController');
const config = require('../config');
const utils = require('../utils');
const errors = require('../errors');
const cf = require('../cf');
const bosh = require('../bosh');
const fabrik = require('../fabrik');
const backupStore = require('../iaas').backupStore;
const catalog = require('../models/catalog');
const ContinueWithNext = errors.ContinueWithNext;
const BadRequest = errors.BadRequest;
const CONST = require('../constants');

class FabrikBaseController extends BaseController {
  constructor() {
    super();
    this.fabrik = fabrik;
    this.cloudController = cf.cloudController;
    this.uaa = cf.uaa;
    this.director = bosh.director;
    this.backupStore = backupStore;
  }

  get serviceBrokerName() {
    return _.get(config, 'broker_name', 'service-fabrik-broker');
  }

  getConfigPropertyValue(name, defaultValue) {
    return _.get(config, name, defaultValue);
  }

  validateUuid(uuid, description) {
    if (!this.constructor.uuidPattern.test(uuid)) {
      throw new BadRequest(`Invalid ${description || 'uuid'} '${uuid}'`);
    }
  }

  validateDateString(isoDateString) {
    if (isoDateString && isNaN(Date.parse(isoDateString))) {
      throw new BadRequest(`Invalid Date String ${isoDateString}`);
    }
  }

  ensurePlatformContext(req, res) {
    /* jshint unused:false */
    return Promise.try(() => {
        const context = _.get(req, 'body.context');
        if (context === undefined && req.body.space_guid && req.body.organization_guid) {
          _.set(req.body, 'context', {
            platform: CONST.PLATFORM.CF,
            organization_guid: req.body.organization_guid,
            space_guid: req.body.space_guid
          });
        }
      })
      .throw(new ContinueWithNext());
  }

  assignInstance(req, res) {
    /* jshint unused:false */
    const instance_id = req.params.instance_id;
    const service_id = req.body.service_id || req.query.service_id;
    const plan_id = req.body.plan_id || req.query.plan_id;
    this.validateUuid(instance_id, 'Service Instance ID');
    this.validateUuid(service_id, 'Service ID');
    this.validateUuid(plan_id, 'Plan ID');
    const encodedOp = _.get(req, 'query.operation', undefined);
    const operation = encodedOp === undefined ? null : utils.decodeBase64(encodedOp);
    const context = _.get(req, 'body.context') || _.get(operation, 'context');
    return this
      .createInstance(instance_id, service_id, plan_id, context)
      .tap(instance => _
        .chain(req)
        .set('instance', instance)
        .set('manager', instance.manager)
        .commit()
      )
      .throw(new ContinueWithNext());
  }

  assignManager(req, res) {
    /* jshint unused:false */
    return Promise
      .try(() => {
        const plan_id = req.body.plan_id || req.query.plan_id;
        if (plan_id) {
          this.validateUuid(plan_id, 'Plan ID');
          return plan_id;
        }
        const instance_id = req.params.instance_id;
        assert.ok(instance_id, 'Middleware assignManager requires a plan_id or instance_id');
        return this.cloudController
          .findServicePlanByInstanceId(instance_id)
          .then(body => body.entity.unique_id);
      })
      .then(plan_id => this.createManager(plan_id))
      .tap(manager => _.set(req, 'manager', manager))
      .throw(new ContinueWithNext());
  }

  getInstanceId(deploymentName) {
    return _.nth(this.fabrik.DirectorManager.parseDeploymentName(deploymentName), 2);
  }

  createManager(plan_id) {
    return this.fabrik.createManager(this.getPlan(plan_id));
  }

  createInstance(instance_id, service_id, plan_id, context) {
    return this.fabrik.createInstance(instance_id, service_id, plan_id, context);
  }

  getPlan(plan_id) {
    return catalog.getPlan(plan_id);
  }
}

FabrikBaseController.uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
FabrikBaseController.k8sNamespacePattern = /^[0-9a-z\-]+$/i;

module.exports = FabrikBaseController;