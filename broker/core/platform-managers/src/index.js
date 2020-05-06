'use strict';
const {
  CONST,
  commonFunctions: {
    getPlatformFromContext
  }
} = require('@sf/common-utils');

exports.BasePlatformManager = require('./BasePlatformManager');
exports.getPlatformManager = function(context) {
  const BasePlatformManager = require('./BasePlatformManager');
  let platform = getPlatformFromContext(context);
  const PlatformManager = (platform && CONST.PLATFORM_MANAGER[platform]) ? require(`./${CONST.PLATFORM_MANAGER[platform]}`) : ((platform && CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]) ? require(`./${CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]}`) : undefined);
  if (PlatformManager === undefined) {
    return new BasePlatformManager(platform);
  } else {
    return new PlatformManager(platform);
  }
};
