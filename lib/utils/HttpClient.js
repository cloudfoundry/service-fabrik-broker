'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const request = require('request');
const errors = require('../errors');
const logger = require('../logger');
const config = require('../config');
const CommandsFactory = require('hystrixjs').commandFactory;
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;
const InternalServerError = errors.InternalServerError;

class HttpClient {
  constructor(options) {
    this.defaultRequest = Promise.promisify(request.defaults(options), {
      multiArgs: true
    });
    this.defaultOptions = options;
    this.commandMap = {};
    if (config.enable_circuit_breaker) {
      const httpCircuitConfig = _.get(config, `circuit_breaker.http`);
      if (httpCircuitConfig) {
        const apiConfig = httpCircuitConfig.apis[options.baseUrl];
        if (apiConfig) {
          logger.silly(`apiconfig ${options.baseUrl}`, apiConfig);
          apiConfig.name = apiConfig.name.replace(/\s*/g, '');
          const commonConfig = _.assign({},
            _.omit(httpCircuitConfig, 'apis'),
            _.omit(apiConfig, 'api_overrides'));
          logger.silly(`Creating command '${apiConfig.name}_BASE_CIRCUIT' with options:${JSON.stringify(commonConfig)}`);
          this.commandMap.BASE_CIRCUIT = this.createCommand(`${apiConfig.name}_BASE_CIRCUIT`, commonConfig);
          _.each(apiConfig.api_overrides, (apiOverrideConfig, httpMethod) => {
            const apiConfig = _.assign({}, commonConfig, _.omit(apiOverrideConfig, 'method_overrides'));
            const commandKey = `${_.toUpper(httpMethod)}_CIRCUIT`;
            this.commandMap[commandKey] = this.createCommand(commandKey, apiConfig);
            logger.silly(`Created command '${commandKey}' with options:${JSON.stringify(this.commandMap[commandKey].circuitConfig)}`);
            _.each(apiOverrideConfig.method_overrides, (methodOverRideConfig, url) => {
              const methodConfig = _.assign({}, apiConfig, methodOverRideConfig);
              const commandKey = _.toUpper(`${url}_${httpMethod}_CIRCUIT`);
              this.commandMap[commandKey] = this.createCommand(commandKey, methodConfig);
              logger.silly(`Creating command '${commandKey}' with options:${JSON.stringify(methodConfig)}`);
            });
          });
        } else {
          logger.warn(`Circut breaker not configured for ${options.baseUrl}`);
        }
      } else {
        logger.warn('Circuit breaker config not found for HTTP. Hystrix will not be configured for ${options.baseUrl}');
      }
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

  getCommand(url, method) {
    url = _.toUpper(url);
    method = _.toUpper(method);
    if (this.commandMap[`${url}_${method}_CIRCUIT`]) {
      return this.commandMap[`${url}_${method}_CIRCUIT`];
    } else if (this.commandMap[`${method}_CIRCUIT`]) {
      return this.commandMap[`${method}_CIRCUIT`];
    } else if (this.commandMap.BASE_CIRCUIT) {
      return this.commandMap.BASE_CIRCUIT;
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
        let err;
        switch (res.statusCode) {
        case 400:
          logger.warn(message, {
            request: options,
            response: result
          });
          err = new BadRequest(message);
          break;
        case 404:
          logger.debug(message);
          err = new NotFound(message);
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
        }
        throw err;
      }
      return result;
    });
  }

  request(options, expectedStatusCode) {
    const command = this.getCommand(options.url, options.method);
    if (command) {
      return Promise.try(() => command.execute(options, expectedStatusCode));
    }
    return this.invoke(options, expectedStatusCode);
  }
}

module.exports = HttpClient;