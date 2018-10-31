'use strict';

const SerialServiceFlowOperator = require('./SerialServiceFlowOperator');
const TaskOperator = require('./task/TaskOperator');
const swf = new SerialServiceFlowOperator();
const tm = new TaskOperator();
swf.init();
tm.init();