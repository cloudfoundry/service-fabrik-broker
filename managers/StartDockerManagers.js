'use strict';

const DockerManager = require('./docker-manager/DockerManager');
const DockerBindManager = require('./docker-manager/DockerBindManager');

const dockerManager = new DockerManager();
const dockerBindManager = new DockerBindManager();
dockerManager.init();
dockerBindManager.init();