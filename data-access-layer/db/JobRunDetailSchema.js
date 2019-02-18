'use strict';

const Mongoose = require('mongoose');
const CONST = require('../../common/constants');

const JobRunDetailSchema = new Mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true
  },
  type: {
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
  response: {
    type: Object
  },
  statusCode: {
    type: String,
    required: true
  },
  statusMessage: {
    type: String
  },
  startedAt: {
    type: Date,
    default: Date.now,
    required: true
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
  },
  processedBy: {
    type: String,
    required: true
  }
});

JobRunDetailSchema.index({
  type: 1,
  'data.instance_id': 1,
  createdAt: 1
});
JobRunDetailSchema.index({
  type: 1,
  'data.instance_id': 1
});
JobRunDetailSchema.index({
  type: 1,
  'data.instance_id': 1,
  'response.delete_backup_status.instance_deleted': 1
});
JobRunDetailSchema.index({
  type: 1,
  'data.instance_id': 1,
  'response.delete_backup_status.instance_deleted': 1,
  createdAt: 1
});
Mongoose.model(CONST.DB_MODEL.JOB_RUN_DETAIL, JobRunDetailSchema);
module.exports.JobRunDetailSchema = JobRunDetailSchema;
