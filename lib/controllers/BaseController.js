'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const config = require('../config');
const errors = require('../errors');
const cf = require('../cf');
const bosh = require('../bosh');
const fabrik = require('../fabrik');
const backupStore = require('../iaas').backupStore;
const catalog = require('../models/catalog');
const ContinueWithNext = errors.ContinueWithNext;
const BadRequest = errors.BadRequest;
class BaseController {
  constructor() {
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

  handler(func) {
    const fn = _.isString(func) ? this[func] : func;
    return (req, res, next) => {
      Promise
        .try(() => fn.call(this, req, res))
        .catch(ContinueWithNext, () => {
          _.set(req, 'params_copy', req.params);
          return process.nextTick(next);
        })
        .catch((err) => {
          _.set(req, 'params_copy', req.params);
          return next(err);
        });
      // Explictly copying the original request parameters into another request
      // parameter as expressjs wipes out req.params in case of error
      // https://github.com/expressjs/express/issues/2117
    };
  }

  assignInstance(req, res) {
    /* jshint unused:false */
    const instance_id = req.params.instance_id;
    const service_id = req.body.service_id || req.query.service_id;
    const plan_id = req.body.plan_id || req.query.plan_id;
    this.validateUuid(instance_id, 'Service Instance ID');
    this.validateUuid(service_id, 'Service ID');
    this.validateUuid(plan_id, 'Plan ID');
    return this
      .createInstance(instance_id, service_id, plan_id)
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

  validateRequest(req, res) {
    if (req.instance.async && ((!req.query) || (!req.query.accepts_incomplete) ||
        req.query.accepts_incomplete !== 'true')) {
      res.status(422).send({
        error: 'AsyncRequired',
        description: 'This request requires client support for asynchronous service operations.'
      });
    }
  }

  getInstanceId(deploymentName) {
    return _.nth(this.fabrik.DirectorManager.parseDeploymentName(deploymentName), 2);
  }

  createManager(plan_id) {
    return this.fabrik.createManager(this.getPlan(plan_id));
  }

  createInstance(instance_id, service_id, plan_id) {
    return this.fabrik.createInstance(instance_id, service_id, plan_id);
  }

  getPlan(plan_id) {
    return catalog.getPlan(plan_id);
  }
}

BaseController.uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

module.exports = BaseController;