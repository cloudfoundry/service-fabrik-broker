'use strict';

const Mongoose = require('mongoose');
const CONST = require('../../../common/constants');
const config = require('../../../common/config');

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
    required: true
  },
  eventName: {
    type: String,
    required: true
  },
  completeEventName: {
    type: String,
    required: true
  },
  metric: {
    type: Number,
    required: true,
    validate: validateMetric
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
    required: true
  },
  createdBy: {
    type: String,
    required: true
  }
});

Mongoose.model(CONST.DB_MODEL.EVENT_DETAIL, EventDetailSchema);
module.exports.EventDetailSchema = EventDetailSchema;