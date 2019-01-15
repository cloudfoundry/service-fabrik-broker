'use strict';

exports.jwt = require('./jwt');
exports.middleware = require('./middleware');
exports.bootstrap = bootstrap;
exports.loadCatalogFromAPIServer = loadCatalogFromAPIServer;
const config = require('../../common/config');
if (config.enable_swarm_manager) {
  exports.docker = require('../../data-access-layer/docker');
}

const Promise = require('bluebird');
const catalog = require('../../common/models').catalog;
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

function loadCatalogFromAPIServer() {
  if (config.apiserver.isServiceDefinitionAvailableOnApiserver) {
    const eventmesh = require('../../data-access-layer/eventmesh');
    return eventmesh.apiServerClient.getAllServices()
      .tap(services => {
        config.services = services;
      })
      .then((services) => {
        return Promise.all(Promise.each(services, service => {
          return eventmesh.apiServerClient.getAllPlansForService(service.id)
            .then(plans => {
              service.plans = plans;
            });
        }));
      })
      .then(() => catalog.reload())
      .tap(() => logger.silly('Loaded Services in catalog Are ', catalog.services))
      .tap(() => logger.silly('Loaded Plans in catalog Are ', catalog.plans));
  }
}