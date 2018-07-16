'use strict';

const _ = require('lodash');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const config = require('../../common/config');
const logger = require('../../common/logger');

// merge does not update properties if new value is undefined
module.exports = new FileStore(_.merge({
  path: './store/sessions',
  logFn: logger.info,
  ttl: config.external.session_expiry
}, config.session_store));