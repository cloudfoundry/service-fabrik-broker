'use strict';

const PostgresqlOperator = require('./postgresql-operator/PostgresqlOperator');
const PostgresqlBindOperator = require('./postgresql-operator/PostgresqlBindOperator');

const postgresqlOperator = new PostgresqlOperator();
const postgresqlBindOperator = new PostgresqlBindOperator();
postgresqlOperator.init();
postgresqlBindOperator.init();