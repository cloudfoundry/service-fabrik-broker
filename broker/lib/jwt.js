'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const jwt = require('jsonwebtoken');
const signAsync = Promise.promisify(jwt.sign);
const verifyAsync = Promise.promisify(jwt.verify);

exports.JsonWebTokenError = jwt.JsonWebTokenError;
exports.NotBeforeError = jwt.NotBeforeError;
exports.TokenExpiredError = jwt.TokenExpiredError;
exports.decode = jwt.decode;
exports.sign = function sign(payload, secretOrPrivateKey, options) {
  return signAsync(payload, secretOrPrivateKey, _.defaults({}, options));
};
exports.verify = function verify(jwtString, secretOrPublicKey, options) {
  return verifyAsync(jwtString, secretOrPublicKey, _.defaults({}, options, {
    clockTolerance: 10
  }));
};