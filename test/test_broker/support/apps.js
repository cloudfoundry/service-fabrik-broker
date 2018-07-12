'use strict';

const _ = require('lodash');
//const lib = require('../../../broker/lib');
const routes = require('../../../api-controllers/routes');
const ExpressApp = require('../../../common/ExpressApp');

// internal app
const internal = ExpressApp.create('internal', app => {
  // home
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin', routes.admin);
  // cloud foundry service broker api
  app.use('/:platform(cf|k8s)', routes.broker);
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
  app.use('/api', routes.api);
  // manage
  app.use('/manage', routes.manage);
});

const report = ExpressApp.create('report', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin/report', routes.report);
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