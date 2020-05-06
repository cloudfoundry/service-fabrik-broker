'use strict';

console.log('Starting Service Fabrik Deployment Hook App...');

// set NODE_CMD process environment
process.env.NODE_CMD = process.env.NODE_CMD || 'node';

const { ExpressApp, HttpServer } = require('@sf/express-commons');
const routes = require('./lib/routes');

const hook = ExpressApp.create('hook', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/hook', routes.hook);
});

HttpServer.start(hook);
HttpServer.handleShutdown();

// https://github.com/nodejs/node-v0.x-archive/issues/5054
