'use strict';

const _ = require('lodash');
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
  constructor(options) {
    // If options has rejectUnauthorized: false,
    // create an https agent with this option and pass to axios.
    if (_.get(options, 'rejectUnauthorized', true) == false) {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });
      this.defaultOptions = _.omit(options, 'rejectUnauthorized');
      // Add the new agent to axios options
      this.defaultOptions = _.extend(
        this.defaultOptions, { httpsAgent: httpsAgent }
      );
    }
    this.defaultRequest = axios.create(this.defaultOptions);

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

  validate(res, expectedStatusCode) {
    const result = {
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: res.headers,
      body: res.data
    };
    logger.debug('Received HTTP response:', result);
    if (expectedStatusCode && res.status !== expectedStatusCode) {
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
      // Throwing error inside a catch block of Promise might cause
      // UnhandledPromiseRejectionWarning
      throw err;
    }
    return result;
  }


  invoke(options, expectedStatusCode) {
    expectedStatusCode = expectedStatusCode || options.expectedStatusCode;
    logger.debug('Sending HTTP request with options :', options);
    return this.defaultRequest.request(options).then((res) => {
      return this.validate(res, expectedStatusCode);
    })
      .catch((error) => {
        return this.validate(error.response, expectedStatusCode);
      });
  }

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
