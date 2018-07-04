'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const request = require('request');
const parseUrl = require('url').parse;
const errors = require('../errors');
const logger = require('../logger');
const config = require('../config');
const CONST = require('../constants');
const CommandsFactory = require('hystrixjs').commandFactory;
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;
const Conflict = errors.Conflict;
const UnprocessableEntity = errors.UnprocessableEntity;
const InternalServerError = errors.InternalServerError;

class HttpClient {
  constructor(options) {
    this.defaultRequest = Promise.promisify(request.defaults(options), {
      multiArgs: true
    });
    this.defaultOptions = options;
    this.commandMap = {};
    this.PARSED_URL_MAP = {};
    this.baseUrl = _.get(options, 'baseUrl');
    logger.silly('config.enable_circuit_breaker :', config.enable_circuit_breaker);
    if (config.enable_circuit_breaker) {
      const httpCircuitConfig = _.get(config, `circuit_breaker.http`);
      if (httpCircuitConfig && httpCircuitConfig.apis) {
        this.buildCommandFactory(this.baseUrl);
      } else {
        logger.warn('Circuit breaker config not found for HTTP. Hystrix will not be configured for ${options.baseUrl}');
      }
    }
  }

  buildCommandFactory(baseUrl) {
    const httpCircuitConfig = _.get(config, `circuit_breaker.http`);
    if (baseUrl && httpCircuitConfig) {
      const apiConfig = httpCircuitConfig.apis[baseUrl];
      if (apiConfig === undefined) {
        logger.debug(`Circuit breaker not defined for URL : ${baseUrl}`);
        this.commandMap[baseUrl] = -1;
        return;
      }
      logger.silly('building command factory for url :', baseUrl);
      logger.silly(`apiconfig for - ${baseUrl}`, apiConfig);
      apiConfig.name = apiConfig.name.replace(/\s*/g, '');
      if (apiConfig.name === undefined || apiConfig.name === '') {
        apiConfig.name = baseUrl;
      }
      const commonConfig = _.assign({},
        _.omit(httpCircuitConfig, 'apis'),
        _.omit(apiConfig, 'api_overrides'));
      logger.silly(`Creating command '${baseUrl}_base_circuit' with options:${JSON.stringify(commonConfig)}`);
      const commandKey = _.toLower(`${baseUrl}_base_circuit`);
      this.commandMap[baseUrl] = {};
      this.commandMap[baseUrl].BASE_CMD = this.createCommand(commandKey, commonConfig);
      _.each(apiConfig.api_overrides, (apiOverrideConfig, httpMethod) => {
        const apiConfig = _.assign({}, commonConfig, _.omit(apiOverrideConfig, 'method_overrides'));
        const commandKey = _.toLower(`${baseUrl}_${httpMethod}_circuit`);
        this.commandMap[baseUrl][commandKey] = this.createCommand(commandKey, apiConfig);
        logger.silly(`Created command '${commandKey}' with options: ${JSON.stringify(apiConfig)}`);
        _.each(apiOverrideConfig.method_overrides, (methodOverRideConfig, path) => {
          const methodConfig = _.assign({}, apiConfig, methodOverRideConfig);
          const commandKey = _.toLower(`${baseUrl}_${httpMethod}_${path}_circuit`);
          this.commandMap[baseUrl][commandKey] = this.createCommand(commandKey, methodConfig);
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
    let baseUrl = this.baseUrl || options.baseUrl;
    let path = url;
    if (baseUrl === undefined && url.indexOf('http') !== -1) {
      let urlComponents;
      if (this.PARSED_URL_MAP[url] !== undefined) {
        urlComponents = this.PARSED_URL_MAP[url];
      } else {
        urlComponents = parseUrl(url);
        this.PARSED_URL_MAP[url] = urlComponents;
      }
      baseUrl = _.toLower(`${urlComponents.protocol}//${urlComponents.hostname}:${urlComponents.port}`);
      logger.silly(`base url : ${baseUrl}, url : ${url}`);
      path = urlComponents.pathname;
    }
    if (baseUrl && this.commandMap[baseUrl] === undefined) {
      logger.debug('setting up command factory for url :-', baseUrl);
      this.buildCommandFactory(baseUrl);
    }
    if (baseUrl && this.commandMap[baseUrl]) {
      if (this.commandMap[baseUrl][_.toLower(`${baseUrl}_${httpMethod}_${path}_circuit`)]) {
        return this.commandMap[baseUrl][_.toLower(`${url}_${httpMethod}_circuit`)];
      } else if (this.commandMap[baseUrl][_.toLower(`${baseUrl}_${httpMethod}_circuit`)]) {
        return this.commandMap[baseUrl][_.toLower(`${baseUrl}_${httpMethod}_circuit`)];
      } else if (this.commandMap[baseUrl].BASE_CMD !== -1) {
        return this.commandMap[baseUrl].BASE_CMD;
      }
    }
    return undefined;
  }

  handleError(error) {
    return error;
  }

  invoke(options, expectedStatusCode) {
    expectedStatusCode = expectedStatusCode || options.expectedStatusCode;
    logger.info('Sending HTTP request:', options);
    return this.defaultRequest(options).spread((res, body) => {
      const result = {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        headers: res.headers,
        body: body
      };
      logger.info('Received HTTP response:', result);
      if (expectedStatusCode && res.statusCode !== expectedStatusCode) {
        let message = `Got HTTP Status Code ${res.statusCode} expected ${expectedStatusCode}`;
        if ((res.body && res.body.message) || res.statusMessage) {
          message = res.body && res.body.message ? `${message}. ${res.body.message}` : `${message}. ${res.statusMessage}`;
        }
        let err;
        switch (res.statusCode) {
        case CONST.HTTP_STATUS_CODE.BAD_REQUEST:
          logger.warn(message, {
            request: options,
            response: result
          });
          err = new BadRequest(message);
          break;
        case CONST.HTTP_STATUS_CODE.NOT_FOUND:
          logger.info(message, {
            request: options,
            response: result
          });
          err = new NotFound(message);
          break;
        case CONST.HTTP_STATUS_CODE.CONFLICT:
          logger.debug(message);
          err = new Conflict(message);
          break;
        case CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY:
          logger.debug(message);
          err = new UnprocessableEntity(message);
          break;
        default:
          logger.error(message, {
            request: options,
            response: result
          });
          err = new InternalServerError(message);
          break;
        }
        if (body && typeof body === 'object') {
          err.error = body;
        } else if (typeof body === 'string') {
          try {
            const errResponse = JSON.parse(body);
            err.error = errResponse;
          } catch (err) {
            logger.info('Error occurred while parsing http response- ', err.error);
          }
        }
        throw err;
      }
      return result;
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

module.exports = HttpClient;