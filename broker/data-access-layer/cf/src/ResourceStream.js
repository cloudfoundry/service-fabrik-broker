'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const url = require('url');
const Readable = require('stream').Readable;
const parseUrl = _.partialRight(url.parse, true);
const formatUrl = url.format;
const logger = require('@sf/logger');
const { commonFunctions: {
  streamToPromise
} } = require('@sf/common-utils');

function mergeQuery(url, qs) {
  url.query = _.merge(url.query, qs);
}

class ResourceStream extends Readable {
  constructor(httpClient, tokenIssuer, options) {
    super({
      objectMode: true,
      highWaterMark: 200
    });
    this.httpClient = httpClient;
    this.tokenIssuer = tokenIssuer;
    if (_.isString(options)) {
      this.url = options;
    } else {
      this.url = _
        .chain(options.url)
        .thru(parseUrl)
        .pick('pathname', 'query')
        .tap(_.partialRight(mergeQuery, options.params))
        .thru(formatUrl)
        .value();
      this.bearer = _.replace(
        _.get(options, 'headers.authorization'),
        /Bearer /i, '' // remove token type from header value
      );
    }
    this.isNew = true;
  }

  pushResources(body) {
    const page = _.get(parseUrl(this.url), 'query.page', 1);
    logger.debug(`+-> Fetched resources page ${page} of ${body.total_pages}`);
    let keepOnPushing = true;
    const resources = body.resources;
    _.each(resources, resource => {
      if (!this.push(resource)) {
        keepOnPushing = false;
      }
    });
    if (!body.next_url) {
      logger.debug('+-> Finished fetching resources');
      this.push(null);
      return;
    }
    this.url = body.next_url;
    this.isNew = true;
    if (keepOnPushing) {
      logger.debug('+-> Continue fetching resources');
      this.fetchResources();
    }
  }

  fetchResources() {
    if (!this.isNew) {
      return;
    }
    this.isNew = false;
    logger.info(`Fetching resoures for '${this.url}'...`);
    return Promise
      .try(() => this.bearer || this.tokenIssuer.getAccessToken())
      .then(bearer => this.httpClient
        .request({
          method: 'GET',
          url: this.url,
          auth: false, // Disabling basic auth,
          headers: { // and passing bearer auth in header
            authorization: `Bearer ${bearer}`,
            'Content-type': 'application/json'
          },
          responseType: 'json'
        }, 200)
      )
      .then(res => this.pushResources(res.body));
  }

  _read() {
    this.fetchResources();
  }

  all() {
    return streamToPromise(this, {
      objectMode: true
    });
  }
}

module.exports = ResourceStream;
