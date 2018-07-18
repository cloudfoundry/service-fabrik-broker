'use strict';

const _ = require('lodash');
const Mongoose = require('mongoose');
const CONST = require('../../common/constants');

function validateState(state) {
  return _
    .chain(CONST.OPERATION)
    .values()
    .find((val) => val === state)
    .value() !== undefined;
}

const MaintenanceDetailSchema = new Mongoose.Schema({
  fromVersion: {
    type: String,
    index: true
  },
  toVersion: {
    type: String,
    index: true
  },
  reason: {
    type: String,
    required: true
  },
  state: {
    type: String,
    required: true,
    validate: validateState
  },
  progress: [{
    type: String,
    required: true
  }],
  completedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  createdBy: {
    type: String,
    required: true
  },
  updatedBy: {
    type: String,
    required: true
  }
});

Mongoose.model(CONST.DB_MODEL.MAINTENANCE_DETAIL, MaintenanceDetailSchema);
module.exports.MaintenaceDetailSchema = MaintenanceDetailSchema;