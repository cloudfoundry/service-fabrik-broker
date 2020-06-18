'use strict';

const SerialServiceFlowOperator = require('./SerialServiceFlowOperator');
const TaskOperator = require('./task/TaskOperator');
const ssfOperator = new SerialServiceFlowOperator();
const taskOperator = new TaskOperator();
ssfOperator.init();
taskOperator.init();
