'use strict';

const routes = require('../../../applications/deployment_hooks/lib/routes');
const { ExpressApp } = require('@sf/express-commons');

// hook app
const hook = ExpressApp.create('hook', app => {
  app.get('/', (req, res) => {
    res.render('index', {
      title: app.get('title')
    });
  });
  app.use('/hook', routes.hook);
});
exports.hook = hook;
