'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../../common/config');
const docker = require('../../../data-access-layer/docker');
const BaseManager = require('./BaseManager');
const DockerInstance = require('./DockerInstance');
const dockerClient = docker.client;

class DockerManager extends BaseManager {
  constructor(plan) {
    super(plan);
    this.credentials = docker.createCredentials(this.plan.credentials);
    this.imageInfo = undefined;
  }

  get imageName() {
    const image = _
      .chain(this.settings)
      .get('image')
      .trim()
      .value();
    const tag = _
      .chain(this.settings)
      .get('tag', 'latest')
      .trim()
      .value();
    return `${image}:${tag}`;
  }

  get hostIsLocal() {
    return _.isEmpty(config.docker.host) || _.includes(['localhost', '127.0.0.1'], config.docker.host);
  }

  get hostIp() {
    return this.hostIsLocal ? config.internal.ip : config.docker.host;
  }

  getContainerName(guid) {
    return `${this.constructor.prefix}-${guid}`;
  }

  static get prefix() {
    return config.docker.prefix || super.prefix;
  }

  static load(plan) {
    if (this[plan.id]) {
      return Promise.resolve(this[plan.id]);
    }

    const manager = new this(plan);

    return dockerClient
      .getImage(manager.imageName)
      .inspectAsync()
      .tap(imageInfo => {
        manager.imageInfo = imageInfo;
        this[plan.id] = manager;
      })
      .return(manager);
  }

  static get instanceConstructor() {
    return DockerInstance;
  }
}

module.exports = DockerManager;