'use strict';

const SerialWorkFlowManager = require('./SerialWorkFlowManager');
const TaskManager = require('./task/TaskManager');
const swf = new SerialWorkFlowManager();
const tm = new TaskManager();
swf.init();
tm.init();