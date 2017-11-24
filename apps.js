'use strict';

const path = require('path');
const _ = require('lodash');
const moment = require('moment');
const yaml = require('js-yaml');
const express = require('express');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const lib = require('./lib');
const config = lib.config;
const logger = lib.logger;
const routes = lib.routes;
const middleware = lib.middleware;
const connectTimeout = require('connect-timeout');

// internal app
const internal = createApp('internal', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin', routes.admin);
  // cloud foundry service broker api
  app.use('/cf', routes.cf);
});

// exernal app
const external = createApp('external', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  // service fabrik api
  app.use('/api', routes.api);
  // manage
  app.use('/manage', routes.manage);
});

module.exports = _
  .chain([
    internal,
    external
  ])
  .set('internal', internal)
  .set('external', external)
  .value();

function createApp(type, addRoutes) {
  const app = express();
  app.locals.moment = moment;
  const cfg = _.get(config, type);
  _
    .chain(app.locals)
    .set('_', _)
    .set('yaml', yaml)
    .commit();

  app.set('env', process.env.NODE_ENV || 'development');
  app.set('port', cfg.port);
  app.set('type', type);
  app.set('title', cfg.title || `Service Fabrik Broker (${type})`);
  if (cfg.ssl) {
    app.set('ssl', cfg.ssl);
  }
  app.disable('etag');
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'pug');
  if (cfg.trust_proxy) {
    app.set('trust proxy', cfg.trust_proxy);
  }
  app.use(morgan('combined', {
    stream: logger.stream
  }));
  app.use(middleware.requireHttps(cfg));
  app.use(connectTimeout(config.http_timeout, {
    respond: true
  }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(bodyParser.urlencoded({
    extended: true
  }));
  app.use(bodyParser.json());
  if (cfg.log_event) {
    app.use(middleware.requireEventLogging(cfg, type));
  }
  // routes
  addRoutes(app);

  // catch 404 and forward to error handler
  app.use(middleware.notFound());

  // error handler
  app.use(middleware.error({
    formats: ['text', 'html', 'json']
  }));

  return app;
}