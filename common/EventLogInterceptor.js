'use strict';
const _ = require('lodash');
const path = require('path');
const logger = require('./logger');
const pubsub = require('pubsub-js');
const config = require('./config');
const os = require('os');
const utils = require('./utils');
const fs = require('fs');
const yaml = require('js-yaml');
const CONST = require('./constants');

class EventLogInterceptor {
  constructor(eventType, appType) {
    const configFileName = `eventlog-config-${appType}.yml`;
    const eventConfAbsPath = process.env.CONF_DIR ? path.join(process.env.CONF_DIR, configFileName) :
      path.join(__dirname, 'config', configFileName);
    this.EVENT_LOG_CONFIG = yaml.safeLoad(fs.readFileSync(eventConfAbsPath, 'utf8'));
    this.eventType = eventType;
  }

  static getInstance(eventType, appType) {
    const id = `${eventType}_${appType}`;
    if (EventLogInterceptor.instances[id] === undefined) {
      EventLogInterceptor.instances[id] = new EventLogInterceptor(eventType, appType);
    }
    return EventLogInterceptor.instances[id];
  }

  createEventDetails(req, res, eventConfig, resBody) {
    resBody = resBody || '';
    let operationConfig;
    if (eventConfig.op_name_in_request) {
      //If operation name in request is to be checked. This handles scenarios where within each HTTP Verb,
      //several operations are defined. for ex. enpoints like last_operation, :operation(backup/restore)
      operationConfig = this.getOperationConfig(req, eventConfig);
    } else {
      //OR just normal HTTP verbs are sufficient to determine operations
      //& event config at VERB level is same as Operation level
      operationConfig = eventConfig;
    }
    if (!operationConfig) {
      logger.debug('Event not configured for route : ', req.__route);
      return [];
    }
    if (operationConfig.ignore_service_fabrik_operation && _.get(req, 'body.parameters.service-fabrik-operation') !== undefined) {
      logger.debug('ServiceFabrik operation invoked via Broker API. Ignoring it');
      return [];
    }
    const operationStatus = this.getOperationStatus(res, operationConfig, resBody);
    const requestDetails = _
      .chain({})
      .assign(req.body, req.params, req.query, req.params_copy)
      //req.params_copy gets populated in BaseController.js in handler function
      .set('user', req.user || {})
      .value();
    //If operation status is inprogress and if config says do not log, then skip it
    if (!operationConfig.log_inprogress_state && operationStatus.inprogress) {
      if (res.statusCode === '500') {
        logger.warn(`Potential failure operation! verify : ${operationConfig.event_name} - request : ${requestDetails} - response : ${resBody}`);
      }
      return [];
      //This check is specifically for enpoints like last_operation, :operation(backup/restore),
      //For operations which can be determined at HTTP verb, below is checked in execute() method itself
    }
    const planId = _.get(req, 'body.plan_id') || _.get(req, 'query.plan_id');
    const serviceInstanceType = planId ? `${require('./models/catalog').getPlan(planId).manager.name}.` : (req.service ? `${req.service.name}.` : '');
    const response = _.cloneDeep(resBody);
    utils.maskSensitiveInfo(response);
    const info = this.getEventInfo(serviceInstanceType,
      operationConfig.event_name,
      operationConfig.tags,
      operationStatus,
      requestDetails,
      response);
    logger.info('evnt info', info);
    return [info, operationConfig];
  }

  getEventInfo(serviceInstanceType, eventName, tags, operationStatus, requestDetails, response) {
    return {
      host: os.hostname(),
      eventName: `${config.monitoring.event_name_prefix}.${serviceInstanceType}${eventName}`,
      metric: operationStatus.metric,
      state: operationStatus.state,
      description: operationStatus.message,
      tags: tags || '',
      time: new Date().getTime(),
      request: requestDetails,
      response: response
    };
  }

  getOperationConfig(req, eventConfig) {
    if (eventConfig.op_name_in_request.path) {
      let operation = _.get(req, eventConfig.op_name_in_request.path);
      if (!operation) {
        logger.warn(`Check eventlog config for this endpoint: '${req.originalUrl}'. Operation name not found in request`);
        return;
      }
      if (eventConfig.op_name_in_request.decode) {
        operation = utils.decodeBase64(operation);
      }
      if (typeof operation === 'string' && !eventConfig.op_name_in_request.lookup_params) {
        //If operation name is string and there are no lookup params, then the value at the
        //path itself is the name of the operation and no need for further lookup. (ex. :operation(backup/restore))
        return eventConfig[operation] ? _.assign(eventConfig[operation],
          _.pick(eventConfig, 'cf_last_operation', 'http_success_codes', 'http_inprogress_codes')) : undefined;
      } else {
        const operationNames = eventConfig.op_name_in_request.lookup_params;
        if (operation.username) {
          _.set(req.user, 'behalfOf.name', operation.username);
        }
        if (operation.useremail) {
          _.set(req.user, 'behalfOf.email', operation.useremail);
        }
        for (let i = 0; i < operationNames.length; i++) {
          let operationType = _.get(operation, operationNames[i]);
          if (operationType) {
            return eventConfig[operationType] ? _.assign(eventConfig[operationType],
              _.pick(eventConfig, 'cf_last_operation', 'http_success_codes', 'http_inprogress_codes')) : undefined;
          }
        }
      }
    }
  }

  successState(eventConfig) {
    return {
      state: config.monitoring.success_state,
      metric: config.monitoring.success_metric,
      message: `${eventConfig.description} succeeded`,
      inprogress: false
    };
  }

  inProgressState(eventConfig) {
    return {
      state: config.monitoring.inprogress_state,
      metric: config.monitoring.inprogress_metric,
      message: `${eventConfig.description} in-progress`,
      inprogress: true
    };
  }

  failureState(statusCode, eventConfig) {
    return {
      state: config.monitoring.failure_state,
      metric: config.monitoring.failure_metric,
      message: `${eventConfig.description} failed. HTTP Status : ${statusCode}`,
      inprogress: false
    };
  }

  getOperationStatus(res, eventConfig, resBody) {
    //Method operation status either follows CF Last operation semantics
    //OR normal HTTP method response states
    if (eventConfig.cf_last_operation || eventConfig.check_res_body) {
      switch (resBody.state) {
      case 'succeeded':
        return this.successState(eventConfig);
      case 'aborted':
      case 'failed':
        return this.failureState(res.statusCode, eventConfig);
      default:
        //Per design of cf last operation, internal server errors (500) are not flagged as errors with completed sate
        //by broker. They are returned back to cloud controller with in-progress status, with the hope that whatever was
        //the reason which caused the internal server error might get fixed by the cloud controller timeout time,
        //at which time CC will stop polling for status and will mark the operation as failed.
        //Hence keeping in-progress as default state if it is not conclusively success/failure state.
        if (res.statusCode === 410 && eventConfig.event_name === 'delete_instance') {
          return this.successState(eventConfig);
        }
        return this.inProgressState(eventConfig);
      }
    } else if (_.includes(eventConfig.http_success_codes, res.statusCode)) {
      return this.successState(eventConfig);
    } else if (_.includes(eventConfig.http_inprogress_codes, res.statusCode)) {
      return this.inProgressState(eventConfig);
    }
    return this.failureState(res.statusCode, eventConfig);
  }

  isURLConfiguredForEventLog(uri, httpMethod) {
    const path = `${uri}.${httpMethod}.enabled`;
    return _.get(this.EVENT_LOG_CONFIG, path, false);
  }

  isOperationComplete(statusCode, eventConfig) {
    return !(_.includes(eventConfig.http_inprogress_codes, statusCode));
  }

  logUnauthorizedEvent(req, res, resBody) {
    const requestDetails = _
      .chain(req)
      .pick('ip', 'originalUrl', 'xhr', 'user', 'params', 'query', 'body')
      .set('user_agent', req.get('User-Agent'))
      .value();
    const eventInfo = {
      host: os.hostname(),
      eventName: `${config.monitoring.event_name_prefix}.${config.monitoring.unauthorized.event_name}`,
      metric: config.monitoring.failure_metric,
      state: config.monitoring.failure_state,
      description: `${config.monitoring.unauthorized.description}. HTTP Status : ${res.statusCode}`,
      tags: config.monitoring.unauthorized.tags,
      time: new Date().getTime(),
      request: requestDetails,
      response: resBody
    };
    logger.error('[AUDIT] Unauthorized access attempted : ', eventInfo);
    pubsub.publish(this.eventType, {
      event: eventInfo,
      config: {}
    });
  }

  publishAndAuditLogEvent(url, method, request, response, checkResponseBody, instanceType) {
    try {
      const eventConfig = _.clone(this.getEventConfig(url, method));
      if (eventConfig === undefined) {
        return undefined;
      }
      if (checkResponseBody) {
        eventConfig.check_res_body = true;
      }
      const opStatus = this.getOperationStatus(response, eventConfig, response.body);
      instanceType = instanceType === undefined ? CONST.INSTANCE_TYPE.DIRECTOR : instanceType;
      instanceType = instanceType.length > 0 ? `${instanceType}.` : instanceType;
      const eventInfo = this.getEventInfo(instanceType,
        eventConfig.event_name,
        eventConfig.tags,
        opStatus,
        request,
        response.body);
      pubsub.publish(this.eventType, {
        event: eventInfo,
        config: eventConfig
      });
      const auditMessage = this.formatAuditMessage(response.statusCode || 200, eventInfo);
      logger.info(auditMessage);
      return eventInfo;
    } catch (err) {
      //Any errors arising out of logging must not bubble up
      logger.error(`Error occurred while publishing event for ${url} : ${method}`, err);
    }
  }

  formatAuditMessage(httpStatusCode, eventInfo) {
    const input = `input : ${JSON.stringify(_.omit(eventInfo.request, 'operation', 'user'))}`;
    const status = `status : ${httpStatusCode}-${eventInfo.state}`;
    const user = `by : ${JSON.stringify(_.pick(eventInfo.request.user, 'name', 'email'))}`;
    return `[AUDIT] Operation : ${eventInfo.eventName} | ${input} | ${status} | ${user}`;
  }

  getEventConfig(path, method) {
    let config = this.EVENT_LOG_CONFIG[path];
    if (method) {
      config = config[method];
    }
    return config;
  }

  execute(req, res, data) {
    logger.debug('intercepting request : ', req.__route);
    const reqPath = req.__route.replace(/\/+$/, '');
    if (res && _.includes(config.monitoring.unauthorized.http_status, res.statusCode)) {
      // irrespective of whether configured or not. UNAUTHENTICATED/UNAUTHORIZED Requests must be logged
      this.logUnauthorizedEvent(req, res, data);
      return;
    }
    if (this.isURLConfiguredForEventLog(reqPath, req.method)) {
      const eventConfig = _.assign({}, this.EVENT_LOG_CONFIG.defaults, this.getEventConfig(reqPath, req.method));
      if (eventConfig.log_inprogress_state || this.isOperationComplete(req.statusCode, eventConfig)) {
        const [eventInfo, operationConfig] = this.createEventDetails(req, res, eventConfig, data);
        if (eventInfo) {
          logger.info(this.formatAuditMessage(res.statusCode, eventInfo));
          pubsub.publish(this.eventType, {
            event: eventInfo,
            config: operationConfig
          });
        }
      }
    }
  }
}
EventLogInterceptor.instances = {};

module.exports = EventLogInterceptor;