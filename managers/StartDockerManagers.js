'use strict';

const DockerOperator = require('./docker-operator/DockerOperator');
const DockerBindOperator = require('./docker-operator/DockerBindOperator');

const dockerOperator = new DockerOperator();
const dockerBindOperator = new DockerBindOperator();
dockerOperator.init();
dockerBindOperator.init();