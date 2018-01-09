'use strict';

console.log('Starting Service Fabrik Report App...');
const lib = require('./lib');
const routes = lib.routes;
const HttpServer = require('./HttpServer');
const FabrikApp = require('./FabrikApp');

const report = FabrikApp.create('report', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/admin/report', routes.report);
});

HttpServer.start(report);
HttpServer.handleShutdown();

//https://github.com/nodejs/node-v0.x-archive/issues/5054