'use strict';

const _ = require('lodash');
// const lib = require('../../../broker/lib');
const adminRoute = require('../../../applications/admin');
const brokerRoute = require('../../../applications/osb-broker/src/api-controllers/routes');
const apiRoute = require('../../../applications/extensions/src/api-controllers/routes');
const reportRoute = require('../../../applications/reports/report');
const { ExpressApp } = require('@sf/express-commons');

// internal app
const internal = ExpressApp.create('internal', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin', adminRoute.admin);
  // cloud foundry service broker api
  app.use('/:platform(cf|k8s|sm)', brokerRoute.broker);
});

// exernal app
const external = ExpressApp.create('external', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  // service fabrik api
  app.use('/api', apiRoute.api);
  // manage
  app.use('/manage', apiRoute.manage);
});

const report = ExpressApp.create('report', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin/report', reportRoute);
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
