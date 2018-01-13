'use strict';

const Mongoose = require('mongoose');
const CONST = require('../constants');

const ReservedIpSchema = new Mongoose.Schema({
  instanceId: {
    type: String,
    required: true,
    index: true
  },
  ip: {
    type: String,
    required: true,
    unique: true
  },
  subnet_range: {
    type: String,
    required: true,
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

Mongoose.model(CONST.DB_MODEL.RESERVED_IP, ReservedIpSchema);
module.exports.ReservedIpSchema = ReservedIpSchema;