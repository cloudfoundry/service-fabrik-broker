'use strict';

const BoshDirectorClient = require('./BoshDirectorClient');
const NetworkSegmentIndex = require('./NetworkSegmentIndex');
const EvaluationContext = require('./EvaluationContext');
const Networks = require('./manifest/Networks');
const Network = require('./manifest/Network');
const Header = require('./manifest/Header');
const Addons = require('./manifest/Addons');
const BoshOperationQueue = require('./BoshOperationQueue');

exports.director = new BoshDirectorClient();
exports.NetworkSegmentIndex = NetworkSegmentIndex;
exports.EvaluationContext = EvaluationContext;
exports.BoshDirectorClient = BoshDirectorClient;
exports.manifest = {
  Networks: Networks,
  Network: Network,
  Header: Header,
  Addons: Addons
};
exports.BoshOperationQueue = BoshOperationQueue;