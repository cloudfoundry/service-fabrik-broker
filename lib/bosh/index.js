'use strict';

const BoshDirectorClient = require('./BoshDirectorClient');
const NetworkSegmentIndex = require('./NetworkSegmentIndex');
const EvaluationContext = require('./EvaluationContext');
const Networks = require('./manifest/Networks');
const Network = require('./manifest/Network');
const Header = require('./manifest/Header');
const config = require('../config');
const CONST = require('../constants');

exports.director = new BoshDirectorClient();
exports.NetworkSegmentIndex = NetworkSegmentIndex;
exports.EvaluationContext = EvaluationContext;
exports.BoshDirectorClient = BoshDirectorClient;
exports.getBoshDirectorByName = getBoshDirectorByName;
exports.manifest = {
  Networks: Networks,
  Network: Network,
  Header: Header
};

function getBoshDirectorByName(name) {
  let boshDirectorConfig;
  switch (name) {
  case CONST.BOSH_DIRECTORS.BOOSTRAP_BOSH:
    boshDirectorConfig = config.bootstrap_bosh_director;
    break;
  default:
    boshDirectorConfig = config.director;
  }
  return new BoshDirectorClient(boshDirectorConfig);
}