'use strict';
/**
 * Monkey patching express router to be able to fetch complete matched route in case of mounted route points.
 * More info : https://github.com/expressjs/express/issues/2879
 */
module.exports = function (express) {
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
