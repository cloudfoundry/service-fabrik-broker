'use strict';

const basicAuth = require('basic-auth');
const {
  errors: {
    NotFound,
    Unauthorized,
    MethodNotAllowed
  }
} = require('@sf/common-utils');

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
