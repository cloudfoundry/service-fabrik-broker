'use strict';

exports.config = require('./config');
exports.errors = require('./errors');
exports.jwt = require('./jwt');
exports.logger = require('./logger');
exports.utils = require('./utils');
exports.store = require('./store');
exports.middleware = require('./middleware');
exports.bosh = require('./bosh');
exports.cf = require('./cf');
exports.docker = require('./docker');
exports.models = require('./models');
exports.routes = require('./routes');
exports.ScheduleManager = require('./jobs');
exports.fabrik = require('./fabrik');
exports.controllers = require('./controllers');
exports.iaas = require('./iaas');
exports.bootstrap = bootstrap;

const logger = exports.logger;
const docker = exports.docker;

function bootstrap() {
  logger.info('Bootstraping docker client...');
  return docker
    .bootstrap()
    .tap(() => logger.debug('Successfully fetched docker images:'))
    .spread((images) => images.forEach(image => logger.debug(image.status)))
    .catch((err) => logger.error('Failed to bootstrap docker client', err));

}