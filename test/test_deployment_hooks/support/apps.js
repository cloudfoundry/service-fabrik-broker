'use strict';

const routes = require('../../../deployment_hooks/lib/routes');
const ExpressApp = require('../../../common/ExpressApp');

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