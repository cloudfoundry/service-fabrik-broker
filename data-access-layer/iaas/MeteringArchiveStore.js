'use strict';

const CONST = require('../../common/constants');
const path = require('path');
const logger = require('../../common/logger');

class MeteringArchiveStore {
  constructor(cloudProvider) {
    this.cloudProvider = cloudProvider;
  }

  getMeteringArchiveFileName(timeStamp) {
    return path.posix.join(CONST.METERING_ARCHIVE_ROOT_FOLDER, `${CONST.METERING_ARCHIVE_JOB_FILE_PREFIX}${timeStamp}.json`);
  }

  async putArchiveFile(timeStamp) {
    const fileName = this.getMeteringArchiveFileName(timeStamp);
    await this.cloudProvider.uploadJson(fileName, { 'meteredEvents':[] });
    logger.info(`Created Metering Archive file: ${fileName}`);
  }

  async patchEventToArchiveFile(event, timeStamp) {
    const fileName = this.getMeteringArchiveFileName(timeStamp);
    let data = await this.cloudProvider.downloadJson(fileName);
    data.meteredEvents.push(event);
    await this.cloudProvider.uploadJson(fileName, data);
    logger.info(`Patched metered event ${event.metadata.name} to archive ${fileName}`);
  }
}

module.exports = MeteringArchiveStore;
