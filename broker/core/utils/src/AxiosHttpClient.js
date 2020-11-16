'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const axios = require('axios');
const https = require('https');
const parseUrl = require('url').parse;
const errors = require('./errors');
const logger = require('@sf/logger');
const config = require('@sf/app-config');
const CONST = require('./commonVariables');
const CommandsFactory = require('hystrixjs').commandFactory;
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;
const Conflict = errors.Conflict;
const UnprocessableEntity = errors.UnprocessableEntity;
const InternalServerError = errors.InternalServerError;


class AxiosHttpClient {
/**
* Creates an axios client with options.
* `responseType` configuration is only supported in request
* and not supported through constructor options.
*/
  constructor(options) {
    this.defaultOptions = this.rejectUnauthorized(options);
    this.client = axios.create(this.defaultOptions);

    this.commandMap = {};
    this.PARSED_URL_MAP = {};
    this.baseURL = _.get(options, 'baseURL');

    logger.silly('config.enable_circuit_breaker :', config.enable_circuit_breaker);
    if (config.enable_circuit_breaker) {
      const httpCircuitConfig = _.get(config, 'circuit_breaker.http');
      if (httpCircuitConfig && httpCircuitConfig.apis) {
        this.buildCommandFactory(this.baseURL);
      } else {
        logger.warn(`Circuit breaker config not found for HTTP. Hystrix will not be configured for ${options.baseURL}`);
      }
    }
  }

  /**
   * Disables rejecting unauthorized certificates if option has
   * `rejectUnauthorized: false`.
   */
  rejectUnauthorized(options) {
    let enhanced_options = options;

    // If options has rejectUnauthorized: false,
    // create an https agent with this option and pass to axios.
    if (_.get(options, 'rejectUnauthorized', true) == false) {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });
      enhanced_options = _.omit(options, 'rejectUnauthorized');
      // Add the new agent to the axios options
      enhanced_options = _.extend(
        enhanced_options, { httpsAgent: httpsAgent }
      );
    }
    return enhanced_options;
  }

  /**
   * Checks options and transforms it into configuration
   * supported by Axios
   */
  enhanceOptions(options) {
    let enhanced_options = this.rejectUnauthorized(options);

    // Workaround for axios/axios/issues/907
    switch (_.get(options, 'responseType')) {
      case 'text':
      case 'document':
        // If responseType is not json,
        // remove default transformResponse which does unintended
        // JSON.parse of response data.
        enhanced_options.transformResponse = options.transformResponse || [];
        break;
    } // Workaround ends

    return enhanced_options;
  }

  buildCommandFactory(baseURL) {
    const httpCircuitConfig = _.get(config, 'circuit_breaker.http');
    if (baseURL && httpCircuitConfig) {
      const apiConfig = httpCircuitConfig.apis[baseURL];
      if (apiConfig === undefined) {
        logger.debug(`Circuit breaker not defined for URL : ${baseURL}`);
        this.commandMap[baseURL] = -1;
        return;
      }
      logger.silly('building command factory for url :', baseURL);
      logger.silly(`apiconfig for - ${baseURL}`, apiConfig);
      apiConfig.name = apiConfig.name.replace(/\s*/g, '');
      if (apiConfig.name === undefined || apiConfig.name === '') {
        apiConfig.name = baseURL;
      }
      const commonConfig = _.assign({},
        _.omit(httpCircuitConfig, 'apis'),
        _.omit(apiConfig, 'api_overrides'));
      logger.silly(`Creating command '${baseURL}_base_circuit' with options:${JSON.stringify(commonConfig)}`);
      const commandKey = _.toLower(`${baseURL}_base_circuit`);
      this.commandMap[baseURL] = {};
      this.commandMap[baseURL].BASE_CMD = this.createCommand(commandKey, commonConfig);
      _.each(apiConfig.api_overrides, (apiOverrideConfig, httpMethod) => {
        const apiConfig = _.assign({}, commonConfig, _.omit(apiOverrideConfig, 'method_overrides'));
        const commandKey = _.toLower(`${baseURL}_${httpMethod}_circuit`);
        this.commandMap[baseURL][commandKey] = this.createCommand(commandKey, apiConfig);
        logger.silly(`Created command '${commandKey}' with options: ${JSON.stringify(apiConfig)}`);
        _.each(apiOverrideConfig.method_overrides, (methodOverRideConfig, path) => {
          const methodConfig = _.assign({}, apiConfig, methodOverRideConfig);
          const commandKey = _.toLower(`${baseURL}_${httpMethod}_${path}_circuit`);
          this.commandMap[baseURL][commandKey] = this.createCommand(commandKey, methodConfig);
          logger.silly(`Creating command '${commandKey}' with options:${JSON.stringify(methodConfig)}`);
        });
      });
    }
  }

  createCommand(key, options) {
    return CommandsFactory.getOrCreate(key, options.name)
      .circuitBreakerErrorThresholdPercentage(options.error_threshold_percentage)
      .timeout(options.service_timeout)
      .run((options, expectedStatusCode) => this.invoke(options, expectedStatusCode))
      .circuitBreakerRequestVolumeThreshold(options.request_volume_threshold)
      .circuitBreakerSleepWindowInMilliseconds(options.sleep_window_in_ms)
      .statisticalWindowLength(options.statistical_window_length)
      .statisticalWindowNumberOfBuckets(options.statistical_window_number_of_buckets)
      .errorHandler(() => this.handleError)
      .build();
  }

  getCommand(options, httpMethod) {
    const url = _.toLower(options.url);
    httpMethod = _.toLower(httpMethod);
    let baseURL = this.baseURL || options.baseURL;
    let path = url;
    if (baseURL === undefined && url.indexOf('http') !== -1) {
      let urlComponents;
      if (this.PARSED_URL_MAP[url] !== undefined) {
        urlComponents = this.PARSED_URL_MAP[url];
      } else {
        // parseUrl creates a URL object from the url
        urlComponents = parseUrl(url);
        this.PARSED_URL_MAP[url] = urlComponents;
      }
      // Creates baseURL from the components
      baseURL = _.toLower(`${urlComponents.protocol}//${urlComponents.hostname}:${urlComponents.port}`);
      logger.silly(`base url : ${baseURL}, url : ${url}`);
      path = urlComponents.pathname;
    }
    if (baseURL && this.commandMap[baseURL] === undefined) {
      logger.debug('setting up command factory for url :-', baseURL);
      this.buildCommandFactory(baseURL);
    }
    if (baseURL && this.commandMap[baseURL]) {
      if (this.commandMap[baseURL][_.toLower(`${baseURL}_${httpMethod}_${path}_circuit`)]) {
        return this.commandMap[baseURL][_.toLower(`${url}_${httpMethod}_circuit`)];
      } else if (this.commandMap[baseURL][_.toLower(`${baseURL}_${httpMethod}_circuit`)]) {
        return this.commandMap[baseURL][_.toLower(`${baseURL}_${httpMethod}_circuit`)];
      } else if (this.commandMap[baseURL].BASE_CMD !== -1) {
        return this.commandMap[baseURL].BASE_CMD;
      }
    }
    return undefined;
  }

  handleError(error) {
    return error;
  }

  enhanceError(res, expectedStatusCode) {
    const result = {
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: res.headers,
      body: res.data
    };
    logger.debug('Received Error with response:', result);
    let message = `Got HTTP Status Code ${res.status} expected ${expectedStatusCode}`;
    if ((res.data && (res.data.message || res.data.description))) {
      message = `${message}. ${res.data.message || res.data.description}`;
    } else if (res.statusText) {
      message = `${message}. ${res.statusText}`;
    }
    let err;
    switch (res.status) {
      case CONST.HTTP_STATUS_CODE.BAD_REQUEST:
        logger.warn(message, {
          response: result
        });
        err = new BadRequest(message);
        break;
      case CONST.HTTP_STATUS_CODE.NOT_FOUND:
        logger.info(message, {
          response: result
        });
        err = new NotFound(message);
        break;
      case CONST.HTTP_STATUS_CODE.CONFLICT:
        logger.info(message, {
          response: result
        });
        err = new Conflict(message);
        break;
      case CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY:
        logger.info(message, {
          response: result
        });
        err = new UnprocessableEntity(message);
        break;
      default:
        logger.error(message, {
          response: result
        });
        err = new InternalServerError(message);
        break;
    }
    if (res.data && typeof res.data === 'object') {
      err.error = res.data;
    } else if (typeof res.data === 'string') {
      try {
        const errResponse = JSON.parse(res.data);
        err.error = errResponse;
      } catch (parseErr) {
        err.message = `${err.message}. ${res.data}`;
      }
    }
    throw err;
  }

  invoke(options, expectedStatusCode) {
    expectedStatusCode = expectedStatusCode || options.expectedStatusCode;
    logger.debug('Sending HTTP request with options :', options);
    let enhanced_options = this.enhanceOptions(options);

    // validateStatus defines whether to resolve or reject the promise
    // for a given HTTP response status code.
    _.defaults(enhanced_options, {
      validateStatus: function (status) {
        if (expectedStatusCode) {
          // response status code should be expected status code.
          return status == expectedStatusCode;
        } else {
          // or in the 2xx range.
          return status >= 200 && status < 300;
        }
      }
    });

    // Wrapping request in Promise.resolve to create a Bluebird Promise
    // This is done to keep the .tap() usage intact.
    return Promise.resolve(this.client.request(enhanced_options))
      .then(res => {
        const result = {
          statusCode: res.status,
          statusMessage: res.statusText,
          headers: res.headers,
          body: res.data
        };
        logger.debug('Received HTTP response:', result);
        return result;
      })
      .catch(error => {
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the expected range.
          this.enhanceError(error.response, expectedStatusCode);
        } else {
          // The request was made but no response was received
          // or, something happened in setting up the request that triggered an Error.
          const err = _.pick(error.toJSON(), [
            'message', 'name', 'description',
            'stack', 'code'
          ]);
          logger.error('HTTP request failed:', err);
          throw new InternalServerError(err.message);
        }
      });
  }

  /**
   * Makes Http requests using axios client
   * and fails if response code is not expectedStatusCode.
   */
  request(options, expectedStatusCode) {
    const command = this.getCommand(options, options.method);
    if (command) {
      logger.silly(`command config for ${options.url}:`, _.omit(command, 'Promise'));
      return Promise.try(() => command.execute(options, expectedStatusCode));
    }
    if (this.PARSED_URL_MAP[`${options.url}_${options.method}`] === undefined) {
      logger.warn(`Circuit breaker not defined for : ${options.url} HTTP Method:${options.method}`);
      this.PARSED_URL_MAP[`${options.url}_${options.method}`] = {};
    }
    return this.invoke(options, expectedStatusCode);
  }
}

module.exports = AxiosHttpClient;
