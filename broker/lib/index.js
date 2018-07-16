'use strict';

exports.jwt = require('./jwt');
exports.utils = require('./utils');
exports.store = require('./store');
exports.middleware = require('./middleware');
exports.cf = require('./cf');
exports.ScheduleManager = require('./jobs');
exports.fabrik = require('./fabrik');
exports.bootstrap = bootstrap;
const config = require('../../common/config');
if (config.enable_swarm_manager) {
  exports.docker = require('./docker');
}
const logger = require('../../common/logger');
const docker = exports.docker;

function bootstrap() {
  logger.info('Bootstraping docker client...');
  return docker
    .bootstrap()
    .tap(() => logger.debug('Successfully fetched docker images:'))
    .spread((images) => images.forEach(image => logger.debug(image.status)))
    .catch((err) => logger.error('Failed to bootstrap docker client', err));

}