'use strict';

const SerialServiceFlowOperator = require('./SerialServiceFlowOperator');
const TaskOperator = require('./task/TaskOperator');
const swfOperator = new SerialServiceFlowOperator();
const taskOperator = new TaskOperator();
swfOperator.init();
taskOperator.init();