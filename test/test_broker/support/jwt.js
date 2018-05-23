'use strict';

const _ = require('lodash');
const lib = require('../../../broker/lib');
const config = lib.config;
const jwt = lib.jwt;

exports.verify = verify;
exports.sign = sign;

function verify(token, name, args) {
  return jwt
    .verify(token, config.password)
    .tap(serviceFabrikOperation => {
      expect(serviceFabrikOperation.name).to.equal(name);
      expect(serviceFabrikOperation.arguments).to.eql(args);
    });
}

function sign(opts, name, args) {
  return jwt
    .sign(_.assign({
        name: name,
        arguments: args
      }, opts),
      config.password);
}