'use strict';

const Mongoose = require('mongoose');
const CONST = require('../../common/constants');

const JobSchema = new Mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true
  },
  interval: {
    type: String,
    required: true
  },
  data: {
    type: Object
  },
  type: {
    type: String,
    required: true
  },
  runOnlyOnce: {
    type: Boolean,
    required: true
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

Mongoose.model(CONST.DB_MODEL.JOB, JobSchema);
module.exports.JobSchema = JobSchema;