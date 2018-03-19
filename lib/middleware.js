'use strict';

const _ = require('lodash');
const basicAuth = require('basic-auth');
const errors = require('./errors');
const logger = require('./logger');
const quota = require('../lib/quota');
const quotaManager = quota.quotaManager;
const CONST = require('../lib/constants');
const Forbidden = errors.Forbidden;
const BadRequest = errors.BadRequest;
const MethodNotAllowed = errors.MethodNotAllowed;
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const EventLogInterceptor = require('./EventLogInterceptor');
const utils = require('./utils');
const EventLogRiemannClient = utils.EventLogRiemannClient;
const EventLogDBClient = utils.EventLogDBClient;
const config = require('./config');
const EventLogDomainSocketClient = utils.EventLogDomainSocketClient;
const interceptor = require('express-interceptor');
const catalog = require('./models/catalog');

exports.basicAuth = function (username, password) {
  return function (req, res, next) {
    const auth = basicAuth(req) || {};
    if (auth.name === username && auth.pass === password) {
      _.set(req, 'user.name', auth.name);
      return next();
    }
    res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
    next(new Unauthorized());
  };
};

exports.requireHttps = function (options) {
  const host = options.host || `${options.hostname}:${options.port}`;
  return function (req, res, next) {
    if (req.secure || options.ssl || options.protocol !== 'https') {
      return next();
    }
    res.redirect(`https://${host}${req.originalUrl}`);
  };
};

exports.methodNotAllowed = function (allow) {
  return function (req, res, next) {
    next(new MethodNotAllowed(req.method, allow));
  };
};

exports.csp = function () {
  const NONE = '\'none\'';
  const SELF = '\'self\'';
  const contentSecurityPolicy = formatContentSecurityPolicy({
    'default-src': [NONE],
    'script-src': [SELF],
    'style-src': [SELF, `https://fonts.googleapis.com`],
    'font-src': [SELF, `https://fonts.gstatic.com`],
    'img-src': [SELF]
  });
  return function (req, res, next) {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    next();
  };
};

exports.notFound = function () {
  return function (req, res, next) {
    next(new NotFound(`Unable to find any resource matching the requested path '${req.path}'`));
  };
};

exports.error = function (options) {
  options = options || {};
  const properties = ['status'];
  const env = options.env || process.env.NODE_ENV;
  if (env !== 'production') {
    properties.push('stack');
  }
  const formats = options.formats || ['text', 'html', 'json'];
  const defaultFormat = options.defaultFormat;
  return function (err, req, res, next) {
    /* jshint unused:false */
    logger.error('Unhandled error:', err);
    const body = _
      .chain(err)
      .pick(properties)
      .defaults({
        status: 500
      })
      .set('error', err.reason)
      .set('description', err.message)
      .value();
    const status = body.status;
    res.status(status);
    if (status === 405 && err.allow) {
      res.set('allow', err.allow);
    }
    const formatter = {
      text: () => res.send(_
        .chain(body)
        .map((value, key) => `${key}: ${value}`)
        .join('\n')
        .value()
      ),
      html: () => res.render('error', body),
      json: () => res.json(body),
      default: () => res.sendStatus(406)
    };
    const defaultFormatter = _.get(formatter, defaultFormat, formatter.default);
    if (_.isEmpty(formats)) {
      return defaultFormatter.call(null);
    }
    res.format(_
      .chain(formatter)
      .pick(formats)
      .set('default', defaultFormatter)
      .value()
    );
  };
};

exports.isFeatureEnabled = function (featureName) {
  return function (req, res, next) {
    if (!utils.isFeatureEnabled(featureName)) {
      throw new errors.ServiceUnavailable(`${featureName} feature not enabled`);
    }
    next();
  };
};

exports.checkQuota = function () {
  return function (req, res, next) {
    if (utils.isServiceFabrikOperation(req.body) || (CONST.HTTP_METHOD.PATCH === req.method && utils.isNotPlanUpdate(req.body))) {
      logger.debug('[Quota]: Check skipped as it is ServiceFabrikOperation or a normal instance update ...: calling next handler..');
      next();
    } else {
      const platform = _.get(req, 'body.context.platform');
      if (platform === CONST.PLATFORM.CF) {
        const orgId = req.body.organization_guid || req.body.context.organization_guid || req.body.previous_values.organization_id;
        if (orgId === undefined) {    
          next(new BadRequest(`organization_id is undefined`));   
        }
        return quotaManager.checkQuota(orgId, req.body.plan_id, req.instance.plan.name, req.instance.service.name)
          .then(quotaValid => {
            logger.debug(`quota api response : ${quotaValid}`);
            if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.NOT_ENTITLED) {
              logger.error(`[QUOTA] Not entitled to create service instance: org '${req.body.organization_guid}', service '${req.instance.service.name}', plan '${req.instance.plan.name}'`);
              next(new Forbidden(`Not entitled to create service instance`));
            } else if (quotaValid === CONST.QUOTA_API_RESPONSE_CODES.INVALID_QUOTA) {
              logger.error(`[QUOTA] Quota is not sufficient for this request: org '${req.body.organization_guid}', service '${req.instance.service.name}', plan '${req.instance.plan.name}'`);
              next(new Forbidden(`Quota is not sufficient for this request`));
            } else {
              logger.debug('[Quota]: calling next handler..');
              next();
            }
          }).catch((err) => {
            logger.error('[QUOTA]: exception occurred --', err);
            next(err);
          });
      } else {
        logger.debug(`[Quota]: Platform: ${platform}. Not ${CONST.PLATFORM.CF}. Skipping quota check : calling next handler..`);
        next();
      }
    }
  };
};

exports.requireEventLogging = function (appConfig, appType) {
  const riemannOptions = _
    .chain({})
    .assign(config.riemann)
    .set('event_type', appConfig.event_type)
    .value();
  const riemannClient = new EventLogRiemannClient(riemannOptions);
  //if events are to be forwarded to monitoring agent via domain socket
  if (appConfig.domain_socket && appConfig.domain_socket.fwd_events) {
    /* jshint unused:false */
    const domainSockOptions = _
      .chain({})
      .set('event_type', appConfig.event_type)
      .set('path', appConfig.domain_socket.path)
      .value();
    const domainSockClient = new EventLogDomainSocketClient(domainSockOptions);
  }
  if (utils.isDBConfigured()) {
    const domainSockClient = new EventLogDBClient({
      event_type: appConfig.event_type
    });
  }
  const eventsLogInterceptor = EventLogInterceptor.getInstance(appConfig.event_type, appType);
  return interceptor((req, res) => ({
    isInterceptable: () => true,
    //intercept all responses
    //Filtering is done in the eventlogging interceptor based on event config

    intercept: (body, send) => send(body),
    //the above dummy intercept is required for HTTP redirects
    //If the above is not provided, they throw exceptions for redirects at client end

    afterSend: (body) => {
      //after response is sent, log the event. This is invoked in process.nextTick
      try {
        const responseContentType = res.get('Content-Type') || '';
        if (responseContentType.indexOf('application/json') !== -1) {
          body = JSON.parse(body);
        }
        eventsLogInterceptor.execute(req, res, body);
        logger.debug('Done processing request: ', req.__route);
      } catch (err) {
        logger.error('Error occurred while logging event :', err);
        //Just log. Even if event logging has issues, should not affect main eventloop.
      }
    }
  }));
};

exports.isPlanDeprecated = function () {
  return function (req, res, next) {
    if (checkIfPlanDeprecated(req.body.plan_id)) {
      logger.error(`Service instance with the requested plan with id : '${req.body.plan_id}' cannot be created as it is deprecated.`);
      throw new Forbidden(`Service instance with the requested plan cannot be created as it is deprecated.`);
    }
    next();
  };
};

function formatContentSecurityPolicy(policy) {
  return _.map(policy, formatContentSecurityPolicyDirective).join(' ');
}

function formatContentSecurityPolicyDirective(values, key) {
  return `${key} ${values.join(' ')};`;
}

function checkIfPlanDeprecated(plan_id) {
  const plan_state = _.get(catalog.getPlan(plan_id), 'metadata.state', CONST.STATE.ACTIVE);
  return plan_state === CONST.STATE.DEPRECATED;
}