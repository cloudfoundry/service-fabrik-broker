'use strict';

const _ = require('lodash');
const config = require('@sf/app-config');
const { JWT } = require('@sf/common-utils');

exports.verify = verify;
exports.sign = sign;

function verify(token, name, args) {
  return JWT
    .verify(token, config.password)
    .tap(serviceFabrikOperation => {
      expect(serviceFabrikOperation.name).to.equal(name);
      expect(serviceFabrikOperation.arguments).to.eql(args);
    });
}

function sign(opts, name, args) {
  return JWT
    .sign(_.assign({
      name: name,
      arguments: args
    }, opts),
    config.password);
}
