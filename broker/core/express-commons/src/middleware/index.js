'use strict';

const _ = require('lodash');
const basicAuth = require('basic-auth');
const interceptor = require('express-interceptor');
const {
  errors: {
    NotFound,
    Unauthorized,
    MethodNotAllowed,
    ServiceUnavailable,
    InternalServerError
  },
  commonFunctions : {
    isFeatureEnabled
  }
} = require('@sf/common-utils');
const logger = require('@sf/logger');
const { initializeEventListener } = require('@sf/event-logger');
const config = require('@sf/app-config');
const BrokerMtlsAPIClient = require('./BrokerMtlsAPIClient');
let landscapeToSubjectPattern = new Map();
let allSubjectPatterns = new Set();

exports.methodNotAllowed = function (allow) {
  return function (req, res, next) {
    next(new MethodNotAllowed(req.method, allow));
  };
};

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

exports.tlsAuth = function () {
  return async function (req, res, next) {
    const clientCertificate = req.headers['ssl-client-cert'];
    if (!clientCertificate) {
      logger.error('clientCertificate not found in the request headers: ', req.headers);
      next(new Unauthorized('Client certificate not found in the request headers'));
    } else {
      let reqSubjectDN = req.headers['ssl-client-subject-dn'];
      if (!reqSubjectDN) {
        logger.error('Failed to read subjectDN from the request headers: ', req.headers);
        return next(new Unauthorized('Failed to read subjectDN from the request headers'));
      }
      let subjectDN = reqSubjectDN.split(',');
      const smCertSubjectPattern = _.get(config, 'smConnectionSettings.sm_certificate_subject_pattern');
      if (!_.isEmpty(smCertSubjectPattern)) {
        let matches = verifySubjectDNWithPattern(subjectDN, splitForwardSlashesAndShift(smCertSubjectPattern));
        if (!matches) {
          logger.error('subject DN does not match the sm_certificate_subject_pattern, subjectDN: ', reqSubjectDN, ' sm_certificate_subject_pattern: ', smCertSubjectPattern);
          return next(new Unauthorized('Subject DN in the request header doesnt match the configured sm_certificate_subject_pattern'));
        }
        next();
      }

      logger.debug('smCertSubjectPattern is not defined. Checking for the endpoints to get the pattern details');
      let endpoints = _.get(config, 'smConnectionSettings.landscape_endpoints');
      if (endpoints.length > 0) {
        try {
          let subjectDnVerified = await verifySubjectDN(subjectDN, endpoints);
          if (!subjectDnVerified) {
            logger.error('subject DN does not match the sm_certificate_subject_pattern fetched from the endpoint, subjectDN: ', reqSubjectDN);
            return next(new Unauthorized('Subject DN in the request header doesnt match the sm_certificate_subject_pattern fetched from the endpoint'));
          }
        } catch (error) {
          logger.error('Caught error trying to validate the subject DN in the request header: ', error);
          return next(new Unauthorized(error.message));
        }
        next();
      } else {
        logger.error('Endpoint required to fetch the certificate subject has either not been defined or its value is not set');
        return next(new Unauthorized('Endpoint required to fetch the certificate subject has either not been defined or its value is not set'));
      }
    }
  };

  function splitForwardSlashesAndShift(smCertSubjectPattern) {
    let splitSubjPattern = smCertSubjectPattern.split('/');
    splitSubjPattern.shift();
    return splitSubjPattern;
  }

  async function verifySubjectDN(subjectDN, endpoints) {
    let index = 0;
    while (index < allSubjectPatterns.length) {
      let smCertSubjectPattern = allSubjectPatterns[index++];
      if (verifySubjectDNWithPattern(subjectDN, smCertSubjectPattern)) {
        return true;
      }
    }
    let i = 0;
    while (i < endpoints.length) {
      let baseUrl = endpoints[i++];
      if (landscapeToSubjectPattern.has(baseUrl)) {
        logger.debug(`Skipping ${baseUrl} as its value is cached.`);
        continue;
      }
      let smCertSubjectPattern = await getSMCertSubjectPattern(baseUrl);
      if (_.isEmpty(smCertSubjectPattern)) {
        logger.error(`Got empty cert info for ${baseUrl}, continuing to check other endpoints`);
        continue;
      }
      if (verifySubjectDNWithPattern(subjectDN, smCertSubjectPattern)) {
        return true;
      }
    }
    return false;
  }

  function verifySubjectDNWithPattern(subjectDN, smCertSubjectPattern) {
    logger.info(`comparing subjectDN ${subjectDN} with smCertSubjectPattern ${smCertSubjectPattern}`);
    return _.isEmpty(_.xor(subjectDN, smCertSubjectPattern));
  }

  async function getSMCertSubjectPattern(baseUrl) {
    let smCertSubjectPattern;
    const mtlsApiClient = new BrokerMtlsAPIClient(baseUrl);
    let retryCount = _.get(config, 'smConnectionSettings.retryCount') + 1;
    while (retryCount > 0) {
      try {
        let smCertInfo = await mtlsApiClient.getCertificateInfo(baseUrl);
        let smCertSubject = smCertInfo.service_manager_certificate_subject;
        smCertSubjectPattern = splitForwardSlashesAndShift(smCertSubject);
        break;
      } catch (error) {
        retryCount--;
        if(retryCount == 0) {
          logger.debug(`Max retries reached while fetching certificate info for ${baseUrl}.`);
          throw new InternalServerError(error.message);
        }
        logger.debug(`Caught error {error} while fetching certificate info for ${baseUrl}. Retrying...`);
      }
    }
    logger.debug(`Populating cache with subjectInfo: ${smCertSubjectPattern} for URL ${baseUrl}`);
    landscapeToSubjectPattern.set(baseUrl, smCertSubjectPattern);
    allSubjectPatterns.add(smCertSubjectPattern);
    return smCertSubjectPattern;
  }
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
  const formats = options.formats || ['json', 'text', 'html'];
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

/**
 * Monkey patching express router to be able to fetch complete matched route in case of mounted route points.
 * More info : https://github.com/expressjs/express/issues/2879
*/

exports.enableAbsMatchingRouteLookup = function (express) {
  const origUse = express.Router.use;
  express.Router.use = function (fn) {
    if (typeof fn === 'string' && Array.isArray(this.stack)) {
      let offset = this.stack.length;
      const result = origUse.apply(this, arguments);
      let layer;
      for (; offset < this.stack.length; offset++) {
        layer = this.stack[offset];
        // I'm not sure if my check for `fast_slash` is the way to go here
        // But if I don't check for it, each stack element will add a slash to the path
        if (layer && layer.regexp && !layer.regexp.fast_slash) {
          layer.__mountpath = fn;
        }
      }
      return result;
    } else {
      return origUse.apply(this, arguments);
    }
  };

  const origPP = express.Router.process_params;

  express.Router.process_params = function (layer, called, req) {
    const path = req.route && (req.route.path || req.route.regexp && req.route.regexp.source) ||
      layer.__mountpath || '';
    if (req.__route && path) {
      const searchFromIdx = req.__route.length - path.length;
      if (req.__route.indexOf(path, searchFromIdx) > 0) {
        // There have been instances (in case of error), where same mount path is repeatedly appended at times.
        // This ensures that if a mountpath is already at the end of the URL, then skip it dont add it.
        return origPP.apply(this, arguments);
      }
    }
    req.__route = (req.__route || '') + path;

    return origPP.apply(this, arguments);
  };
};

exports.isFeatureEnabled = function (featureName) {
  return function (req, res, next) {
    if (!isFeatureEnabled(featureName)) {
      throw new ServiceUnavailable(`${featureName} feature not enabled`);
    }
    next();
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


exports.requireEventLogging = function (appConfig, appType) {
  const eventsLogInterceptor = initializeEventListener(appConfig, appType);
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
