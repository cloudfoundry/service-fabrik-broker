'use strict';

const Mongoose = require('mongoose');
const { CONST } = require('@sf/common-utils');
const config = require('@sf/app-config');

function validateMetric(metric) {
  return metric === config.monitoring.success_metric ||
    metric === config.monitoring.inprogress_metric ||
    metric === config.monitoring.failure_metric;
}

const EventDetailSchema = new Mongoose.Schema({
  host: {
    type: String,
    required: true
  },
  instanceId: {
    type: String,
    required: true,
    index: true
  },
  eventName: {
    type: String,
    required: true,
    index: true
  },
  completeEventName: {
    type: String,
    required: true
  },
  metric: {
    type: Number,
    required: true,
    validate: validateMetric,
    index: true
  },
  state: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  request: {
    type: Object
  },
  response: {
    type: Object
  },
  createdAt: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  createdBy: {
    type: String,
    required: true
  }
});
EventDetailSchema.index({
  eventName: 1,
  instanceId: 1,
  metric: 1,
  createdAt: 1
});
Mongoose.model(CONST.DB_MODEL.EVENT_DETAIL, EventDetailSchema);
module.exports.EventDetailSchema = EventDetailSchema;
