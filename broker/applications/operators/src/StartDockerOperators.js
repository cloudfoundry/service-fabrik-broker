'use strict';

const DockerOperator = require('./docker-operator/DockerOperator');
const DockerBindOperator = require('./docker-operator/DockerBindOperator');
const docker = require('@sf/docker');
const logger = require('@sf/logger');

const dockerOperator = new DockerOperator();
const dockerBindOperator = new DockerBindOperator();

function bootstrap() {
  logger.info('Bootstraping docker client...');
  return docker
    .bootstrap()
    .tap(() => logger.debug('Successfully fetched docker images:'))
    .spread(images => images.forEach(image => logger.debug(image.status)))
    .catch(err => {
      logger.error('Failed to bootstrap docker client', err);
    });
}

bootstrap();
dockerOperator.init();
dockerBindOperator.init();
