'use strict';

const SerialWorkFlowOperator = require('./SerialWorkFlowOperator');
const TaskOperator = require('./task/TaskOperator');
const swf = new SerialWorkFlowOperator();
const tm = new TaskOperator();
swf.init();
tm.init();