'use strict';

const _ = require('lodash');
const winston = require('winston');
const config = require('./config');
/* jshint expr:true */
require('winston-syslog').Syslog; // eslint-disable-line no-unused-expressions

winston.emitErrs = true;

const transports = [
  new winston.transports.File({
    prettyPrint: true,
    level: config.log_level || 'info',
    silent: false,
    colorize: (config.colorize_log !== undefined && config.colorize_log === false) ? false : true,
    timestamp: true,
    filename: config.log_path,
    json: false
  }),
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'debug',
    silent: _.includes(['production', 'test'], process.env.NODE_ENV),
    prettyPrint: true,
    colorize: true,
    timestamp: true
  }),
  new winston.transports.Syslog({
    level: config.sys_log_level || 'info',
    protocol: 'tcp4',
    port: '1514',
    app_name: config.broker_name,
    eol: '\n',
    formatter: options => `[${config.broker_name}] ${options.level.toUpperCase()}  ${options.message || ''}`
  })
];

class Stream {
  constructor(logger) {
    this.logger = logger;
  }
  write(message, encoding) {
    /* jshint unused:false */
    this.logger.info(message);
  }
}

const logger = new winston.Logger({
  transports: transports,
  exitOnError: true
});
logger.stream = new Stream(logger);

module.exports = logger;
