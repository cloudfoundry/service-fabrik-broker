'use strict';

module.exports = require('../common/constants');

module.exports = Object.freeze({
  LOCK_TYPE: {
    WRITE: 'WRITE',
    READ: 'READ'
  },
  LOCK_TTL: 5,
  LOCK_KEY_SUFFIX: '/lock',
  LOCK_DETAILS_SUFFIX: '/lock/details'
});