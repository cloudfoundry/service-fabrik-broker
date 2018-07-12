'use strict';

var moment = require('moment-timezone');
const errors = require('../common/errors');
const logger = require('../common/logger');
const FabrikBaseController = require('./FabrikBaseController');
const BackupReportManager = require('../broker/lib/reports');
const CONST = require('../common/constants');
const BadRequest = errors.BadRequest;

class ServiceFabrikReportController extends FabrikBaseController {
  constructor() {
    super();
  }

  // Method for backup reporting
  getServiceInstanceBackupSummary(req, res) {
    if (!req.params.instance_id || !req.query.start_time || !req.query.end_time) {
      throw new BadRequest('instance_id | start_time | end_time required');
    }
    if (!moment(req.query.start_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid start date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    if (!moment(req.query.end_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid end date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    const start_time = moment.utc(req.query.start_time).toDate();
    const end_time = moment.utc(req.query.end_time).endOf('day').toDate();
    logger.info(`Getting backup summary for ${req.params.instance_id}...`);
    return BackupReportManager
      .getInstanceBackupSummary(req.params.instance_id, start_time, end_time)
      .then(body => res
        .status(200)
        .send(body));
  }

  //Method for getting backup instance ids
  getScheduledBackupInstances(req, res) {
    if (req.query.start_time && !moment(req.query.start_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid start date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    if (req.query.end_time && !moment(req.query.end_time, CONST.REPORT_BACKUP.INPUT_DATE_FORMAT, true).isValid()) {
      throw new BadRequest(`Invalid end date, required format ${CONST.REPORT_BACKUP.INPUT_DATE_FORMAT}`);
    }
    const start_time = req.query.start_time ? moment.utc(req.query.start_time).toDate() : undefined;
    const end_time = req.query.end_time ? moment.utc(req.query.end_time).endOf('day').toDate() : undefined;
    logger.info('Getting scheduled backup instance list...');
    return BackupReportManager
      .getInstancesWithBackupScheduled(start_time, end_time)
      .then(body => res
        .status(200)
        .send(body));
  }

}

module.exports = ServiceFabrikReportController;