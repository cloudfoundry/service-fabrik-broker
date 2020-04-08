'use strict';

console.log('Starting Service Fabrik Report App...');
const routes = require('../api-controllers/routes');
const HttpServer = require('../common/HttpServer');
const ExpressApp = require('../common/ExpressApp');

const report = ExpressApp.create('report', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin/report', routes.report);
});

HttpServer.start(report);
HttpServer.handleShutdown();

// https://github.com/nodejs/node-v0.x-archive/issues/5054
