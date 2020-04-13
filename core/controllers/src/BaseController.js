'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const { errors: {
  ContinueWithNext
} } = require('@sf/common-utils');

class BaseController {
  constructor() {}

  handler(func) {
    const fn = _.isString(func) ? this[func] : func;
    return (req, res, next) => {
      Promise
        .try(() => fn.call(this, req, res))
        .catch(ContinueWithNext, () => {
          _.set(req, 'params_copy', req.params);
          return process.nextTick(next);
        })
        .catch(err => {
          _.set(req, 'params_copy', req.params);
          return next(err);
        });
    };
  }
}
module.exports = BaseController;
