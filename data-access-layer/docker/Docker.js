'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../common/config');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const DockerClient = require('./DockerClient');
const DockerPortRegistry = require('./DockerPortRegistry');
const DockerCredentials = require('./DockerCredentials');
const errors = require('../../common/errors');
const DockerServiceUnavailable = errors.DockerServiceUnavailable;

class Docker {
  constructor() {
    this.client = this.createClient();
    this.portRegistry = new DockerPortRegistry(config.docker.ip_local_port_range);
  }

  createClient() {
    return new DockerClient();
  }

  get catalogImages() {
    function pickImageAndTag(settings) {
      return {
        fromImage: settings.image,
        tag: settings.tag
      };
    }
    return _
      .chain(config.services)
      .map(service => service.plans)
      .flatten()
      .filter(['manager.name', 'docker'])
      .map(plan => pickImageAndTag(plan.manager.settings))
      .uniqWith(_.isEqual)
      .value();
  }

  bootstrap() {
    return utils
      .retry(() => this.client.versionAsync(), {
        maxAttempts: 8,
        minDelay: 4696
      })
      .tap(versionInfo => logger.debug('Docker version information:', versionInfo))
      .then(() => Promise.all([
        this.fetchImages(),
        this.updatePortRegistry()
      ]));
  }

  updatePortRegistry() {
    return this.client
      .listContainersAsync({
        all: 1
      })
      .tap(containers => this.portRegistry.update(containers))
      .tap(() => logger.debug('Port registry has been updated:', this.portRegistry.protocols));
  }

  extractRepoTags(images) {
    return _
      .chain(images)
      .map(image => image.RepoTags)
      .flatten()
      .compact()
      .value();
  }

  getMissingImages() {
    return this.client
      .listImagesAsync({
        all: 1
      })
      .then(images => _
        .chain(this.catalogImages)
        .map(image => `${image.fromImage}:${image.tag}`)
        .difference(this.extractRepoTags(images))
        .value()
      );
  }

  fetchImages() {
    const images = this.catalogImages;
    return Promise
      .map(images, image => this.client
        .createImageAsync(image)
        .then(stream => this.client.followProgressAsync(stream)), {
        concurrency: 7
      })
      .then(results => _
        .chain(results)
        .map(events => _.last(events))
        .zip(images)
        .map(args => _.assign(...args))
        .value()
      );
  }

  createCredentials(options) {
    return new DockerCredentials(options);
  }

  acquirePort(protocol) {
    const port = this.portRegistry.sample(protocol);
    if (!port) {
      throw new DockerServiceUnavailable('All dynamic ports have been exhausted!');
    }
    return port;
  }

  releasePort(protocol, port) {
    return this.portRegistry.remove(protocol, port);
  }

  portsWillBeExhaustedSoon(protocol) {
    return this.portRegistry.willBeExhaustedSoon(protocol);
  }
}

Docker.DockerClient = DockerClient;
Docker.DockerCredentials = DockerCredentials;
Docker.DockerPortRegistry = DockerPortRegistry;

module.exports = Docker;
