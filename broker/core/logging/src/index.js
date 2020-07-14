'use strict';

const _ = require('lodash');
const winston = require('winston');
const config = require('@sf/app-config');
/* jshint expr:true */
require('winston-syslog').Syslog; // eslint-disable-line no-unused-expressions

const transports = [
  new winston.transports.File({
    level: config.log_level || 'info',
    silent: false,
    filename: config.log_path,
    format: winston.format.combine(
      winston.format.prettyPrint(),
      config.colorize_log !== undefined && config.colorize_log === false ? winston.format.uncolorize() : winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf(i => `${i.timestamp} - ${i.level}: ${i.message}`)
    )
  }),
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'debug',
    silent: _.includes(['production', 'test'], process.env.NODE_ENV),
    format: winston.format.combine(
      winston.format.prettyPrint(),
      winston.format.colorize({all:true}),
      winston.format.timestamp(),
      winston.format.printf(i => `${i.timestamp} - ${i.level}: ${i.message}`)
    ),
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

const logger = winston.createLogger({
  transports: transports,
  exitOnError: true
});
logger.stream = new Stream(logger);

module.exports = logger;
