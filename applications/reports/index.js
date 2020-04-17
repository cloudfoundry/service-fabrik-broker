'use strict';

console.log('Starting Service Fabrik Report App...');
const routesReport = require('./report');
const { ExpressApp, HttpServer } = require('@sf/express-commons');

const report = ExpressApp.create('report', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin/report', routesReport);
});

HttpServer.start(report);
HttpServer.handleShutdown();

// https://github.com/nodejs/node-v0.x-archive/issues/5054
