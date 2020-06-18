'use strict';

const _ = require('lodash');
// const lib = require('../../../broker/lib');
const brokerRoute = require('../../../applications/osb-broker/src/api-controllers/routes');
const adminRoute = require('../../../applications/admin/src/admin');
const apiRoute = require('../../../applications/extensions/src/api-controllers/routes');
const reportRoute = require('../../../applications/reports/src/report');
const { ExpressApp } = require('@sf/express-commons');

// internal app
const internal = ExpressApp.create('internal', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
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

// admin app
const admin = ExpressApp.create('admin_app', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  // service fabrik admin api
  app.use('/admin', adminRoute);
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
  .set('admin', admin)
  .value();
