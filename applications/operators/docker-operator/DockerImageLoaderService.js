'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const docker = require('../../data-access-layer/docker');
const dockerClient = docker.client;

class DockerImageLoaderService {
  constructor(plan) {
    this.plan = plan;
    this.imageInfo = undefined;
  }

  get imageName() {
    const image = _
      .chain(this.plan.manager.settings)
      .get('image')
      .trim()
      .value();
    const tag = _
      .chain(this.plan.manager.settings)
      .get('tag', 'latest')
      .trim()
      .value();
    return `${image}:${tag}`;
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

}

module.exports = DockerImageLoaderService;
