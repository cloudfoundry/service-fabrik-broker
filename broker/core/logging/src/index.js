'use strict';

const _ = require('lodash');
const winston = require('winston');
const { SPLAT } = require('triple-beam');
const config = require('@sf/app-config');
/* jshint expr:true */
require('winston-syslog').Syslog; // eslint-disable-line no-unused-expressions

/*
From https://github.com/winstonjs/winston/issues/1408 ,
https://github.com/winstonjs/winston/issues/1217 
etc it was concluded that, in v3, to keep the formatting similar to v2 a custom formatter is the best way to go.
Below custom formatter therefore captures everything info[SPLAT] and stringifies it.
*/
const customFormatter = winston.format((info, opts) => {
  const splat = info[SPLAT] || info.splat;
  if(splat && splat.length) {    
    for(let i = 0; i < splat.length; i++) {
      if(typeof splat[i] === 'object') {
        info.message = `${info.message}\n${JSON.stringify(splat[i], null, 2)}`;
      } else {
        info.message = `${info.message} ${splat[i]}`;
      }
    }
  }
  return info; 
});
const transports = [
  new winston.transports.File({
    level: config.log_level || 'info',
    silent: false,
    filename: config.log_path,
    format: winston.format.combine(
      winston.format.prettyPrint(),
      config.colorize_log !== undefined && config.colorize_log === false ? winston.format.uncolorize() : winston.format.colorize(),
      winston.format.timestamp(),
      customFormatter(),
      winston.format.printf(i => {
        return `${i.timestamp} - ${i.level}: ${i.message}`;
      })
    )
  }),
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || config.log_level || 'debug',
    silent: _.includes(['production', 'test'], process.env.NODE_ENV),
    format: winston.format.combine(
      winston.format.prettyPrint(),
      config.colorize_log !== undefined && config.colorize_log === false ? winston.format.uncolorize() : winston.format.colorize(),
      winston.format.timestamp(),
      customFormatter(),
      winston.format.printf(i => `${i.timestamp} - ${i.level}: ${i.message}`)
    )
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
