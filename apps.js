'use strict';

const _ = require('lodash');
const lib = require('./lib');
const routes = lib.routes;
const FabrikApp = require('./FabrikApp');

// internal app
const internal = FabrikApp.createApp('internal', app => {
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
const external = FabrikApp.createApp('external', app => {
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

const report = FabrikApp.createApp('report', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/report', routes.report);
});

module.exports = _
  .chain([
    internal,
    external,
    report
  ])
  .set('internal', internal)
  .set('external', external)
  .set('report', report)
  .value();