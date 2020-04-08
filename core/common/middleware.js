'use strict';

const _ = require('lodash');
const basicAuth = require('basic-auth');
const errors = require('./errors');
const logger = require('./logger');
const MethodNotAllowed = errors.MethodNotAllowed;
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const utils = require('./utils');
const interceptor = require('express-interceptor');

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
    'style-src': [SELF, 'https://fonts.googleapis.com'],
    'font-src': [SELF, 'https://fonts.gstatic.com'],
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

exports.requireEventLogging = function (appConfig, appType) {
  const eventsLogInterceptor = utils.initializeEventListener(appConfig, appType);
  return interceptor((req, res) => ({
    isInterceptable: () => true,
    // intercept all responses
    // Filtering is done in the eventlogging interceptor based on event config

    intercept: (body, send) => send(body),
    // the above dummy intercept is required for HTTP redirects
    // If the above is not provided, they throw exceptions for redirects at client end

    afterSend: body => {
      // after response is sent, log the event. This is invoked in process.nextTick
      try {
        const responseContentType = res.get('Content-Type') || '';
        if (responseContentType.indexOf('application/json') !== -1) {
          body = JSON.parse(body);
        }
        eventsLogInterceptor.execute(req, res, body);
        logger.debug('Done processing request: ', req.__route);
      } catch (err) {
        logger.error('Error occurred while logging event :', err);
        // Just log. Even if event logging has issues, should not affect main eventloop.
      }
    }
  }));
};

function formatContentSecurityPolicy(policy) {
  return _.map(policy, formatContentSecurityPolicyDirective).join(' ');
}

function formatContentSecurityPolicyDirective(values, key) {
  return `${key} ${values.join(' ')};`;
}
