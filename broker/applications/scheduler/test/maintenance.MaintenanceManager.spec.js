'use strict';

const _ = require('lodash');
const {
  CONST,
  errors: {
    BadRequest
  },
  Repository
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const { maintenanceManager } = require('../src/maintenance');

describe('maintenance', function () {
  /* jshint unused:false */
  /* jshint expr:true */
  describe('#MaintenanceManager', function () {
    const downTimePhse = `${config.broker_drain_message} at ${new Date()}`;
    const maintenanceInfo = {
      fromVersion: '2.0',
      toVersion: '2.1',
      releaseNotes: 'Made Changes to blah, blah',
      progress: [downTimePhse]
    };
    let sandbox, repoSaveStub, repoSearchStub, clock, findOneStub, inMaintenance;
    let maintenaceFound = true;
    before(function () {
      inMaintenance = true;
      clock = sinon.useFakeTimers(new Date().getTime());
      sandbox = sinon.createSandbox();
      repoSaveStub = sandbox.stub(Repository, 'save');
      repoSearchStub = sandbox.stub(Repository, 'search').callsFake(() => Promise.resolve({
        totalRecordCount: maintenaceFound ? 1 : 0,
        list: maintenaceFound ? [{
          state: CONST.OPERATION.SUCCEEDED
        }] : []
      }));
      findOneStub = sandbox.stub(Repository, 'findOne').callsFake(() => Promise.try(() => {
        if (inMaintenance) {
          return _.cloneDeep(maintenanceInfo);
        }
        return null;
      }));
    });
    afterEach(function () {
      inMaintenance = true;
      findOneStub.resetHistory();
      repoSaveStub.resetHistory();
      repoSearchStub.resetHistory();
      maintenaceFound = true;
    });
    after(function () {
      sandbox.restore();
      clock.restore();
    });

    it('should successfully update start of maintenance', function () {
      const maintInfo = _.cloneDeep(maintenanceInfo);
      maintInfo.fromVersion = undefined;
      maintInfo.progress = undefined;
      return maintenanceManager.startMaintenace(_.cloneDeep(maintInfo), CONST.SYSTEM_USER)
        .then(() => {
          maintInfo.progress = [`Service-fabrik maintenace mode is being initiated ${new Date()}`];
          maintInfo.state = CONST.OPERATION.IN_PROGRESS;
          maintInfo.fromVersion = `NA_${new Date().getTime()}`;
          maintInfo.completedAt = null;
          expect(repoSaveStub).to.be.calledOnce;
          expect(repoSaveStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSaveStub.firstCall.args[1]).to.eql(maintInfo);
          expect(repoSaveStub.firstCall.args[2]).to.eql(CONST.SYSTEM_USER);
        });
    });
    it('should successfully update start of maintenance with provided progress info', function () {
      const maintInfo = _.cloneDeep(maintenanceInfo);
      maintInfo.progress = 'Start Maintenance Mode';
      maintInfo.toVersion = undefined;
      return maintenanceManager.startMaintenace(_.cloneDeep(maintInfo), CONST.SYSTEM_USER)
        .then(() => {
          maintInfo.progress = [`${maintInfo.progress} at ${new Date()}`];
          maintInfo.state = CONST.OPERATION.IN_PROGRESS;
          maintInfo.toVersion = `NA_${new Date().getTime()}`;
          maintInfo.completedAt = null;
          expect(repoSaveStub).to.be.calledOnce;
          expect(repoSaveStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSaveStub.firstCall.args[1]).to.eql(maintInfo);
          expect(repoSaveStub.firstCall.args[2]).to.eql(CONST.SYSTEM_USER);
        });
    });
    it('should successfully update progress of maintenance with provided progress info', function () {
      const maintInfo = _.cloneDeep(maintenanceInfo);
      return maintenanceManager.updateMaintenace('SF Deployed', CONST.OPERATION.SUCCEEDED, CONST.SYSTEM_USER)
        .then(() => {
          maintInfo.progress.push(`SF Deployed at ${new Date()}`);
          maintInfo.state = CONST.OPERATION.SUCCEEDED;
          maintInfo.completedAt = new Date();
          expect(repoSaveStub).to.be.calledOnce;
          expect(repoSaveStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSaveStub.firstCall.args[1]).to.eql(maintInfo);
          expect(repoSaveStub.firstCall.args[2]).to.eql(CONST.SYSTEM_USER);
        });
    });
    it('should successfully update progress of maintenance with provided progress info & state remains unchanged', function () {
      const maintInfo = _.cloneDeep(maintenanceInfo);
      return maintenanceManager.updateMaintenace('SF Deployed', undefined, CONST.SYSTEM_USER)
        .then(() => {
          maintInfo.progress.push(`SF Deployed at ${new Date()}`);
          expect(repoSaveStub).to.be.calledOnce;
          expect(repoSaveStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSaveStub.firstCall.args[1]).to.eql(maintInfo);
          expect(repoSaveStub.firstCall.args[2]).to.eql(CONST.SYSTEM_USER);
        });
    });
    it('should throw error if update sate input is invalid', function () {
      const maintInfo = _.cloneDeep(maintenanceInfo);
      return maintenanceManager.updateMaintenace('SF Deployed', 'INVALID_STATE', CONST.SYSTEM_USER)
        .then(() => {
          throw new Error('Should throw error');
        })
        .catch(BadRequest, () => {});
    });
    it('should throw error if progressInfo is blank', function () {
      const maintInfo = _.cloneDeep(maintenanceInfo);
      return maintenanceManager.updateMaintenace('', CONST.OPERATION.SUCCEEDED, CONST.SYSTEM_USER)
        .then(() => {
          throw new Error('Should throw error');
        })
        .catch(BadRequest, () => {});
    });
    it('should throw error if update of maintenance is tried when system is not in maintenance', function () {
      inMaintenance = false;
      const maintInfo = _.cloneDeep(maintenanceInfo);
      return maintenanceManager.updateMaintenace('SF Deployed', CONST.OPERATION.SUCCEEDED, CONST.SYSTEM_USER)
        .then(() => {
          throw new Error('Should throw error');
        })
        .catch(BadRequest, () => {});
    });
    it('should throw error if update of maintenance is tried with empty progress info', function () {
      inMaintenance = false;
      const maintInfo = _.cloneDeep(maintenanceInfo);
      return maintenanceManager.updateMaintenace('', CONST.OPERATION.SUCCEEDED, CONST.SYSTEM_USER)
        .then(() => {
          throw new Error('Should throw error');
        })
        .catch(BadRequest, () => {});
    });
    it('should return the last downtime phase of an on-going maintenance', function () {
      inMaintenance = true;
      return maintenanceManager.getMaintenaceInfo()
        .then(response => {
          expect(findOneStub).to.be.calledOnce;
          expect(maintenanceManager.getLastDowntimePhase(response, config.scheduler.downtime_maintenance_phases)).to.be.eql(downTimePhse);
        });
    });
    it('should return the last maintenance state', function () {
      inMaintenance = false;
      return maintenanceManager.getLastMaintenaceState()
        .then(response => {
          const criteria = {
            sortBy: [
              ['createdAt', 'desc']
            ]
          };
          expect(repoSearchStub).to.be.calledOnce;
          expect(repoSearchStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSearchStub.firstCall.args[1]).to.eql(criteria);
          expect(repoSearchStub.firstCall.args[2]).to.eql({
            records: 1,
            offset: 0
          });
        });
    });
    it('should return the last maintenance state as null when maintenance state has never been set in system', function () {
      inMaintenance = false;
      maintenaceFound = false;
      return maintenanceManager.getLastMaintenaceState()
        .then(response => {
          const criteria = {
            sortBy: [
              ['createdAt', 'desc']
            ]
          };
          expect(repoSearchStub).to.be.calledOnce;
          expect(repoSearchStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSearchStub.firstCall.args[1]).to.eql(criteria);
          expect(repoSearchStub.firstCall.args[2]).to.eql({
            records: 1,
            offset: 0
          });
          expect(response).to.equal(null);
        });
    });
    it('should retrieve history of maintenace for input criteria', function () {
      inMaintenance = false;
      return maintenanceManager.getMaintenaceHistory(0, 50, 'completedAt')
        .then(() => {
          const criteria = {
            sortBy: [
              ['completedAt', 'desc']
            ]
          };
          expect(repoSearchStub).to.be.calledOnce;
          expect(repoSearchStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSearchStub.firstCall.args[1]).to.eql(criteria);
          expect(repoSearchStub.firstCall.args[2]).to.eql({
            records: 50,
            offset: 0
          });
        });
    });
    it('should retrieve history of maintenace for input criteria with default records/offset', function () {
      inMaintenance = false;
      return maintenanceManager.getMaintenaceHistory(-1, 1000, ['completedAt', 'createdAt'], ['asc', 'desc'])
        .then(() => {
          const criteria = {
            sortBy: [
              ['completedAt', 'asc'],
              ['createdAt', 'desc']
            ]
          };
          expect(repoSearchStub).to.be.calledOnce;
          expect(repoSearchStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSearchStub.firstCall.args[1]).to.eql(criteria);
          expect(repoSearchStub.firstCall.args[2]).to.eql({
            records: config.mongodb.record_max_fetch_count,
            offset: 0
          });
        });
    });
    it('should retrieve history of maintenace for  default records/offset and complex combination of sortby/order', function () {
      inMaintenance = false;
      return maintenanceManager.getMaintenaceHistory(undefined, undefined, ['completedAt', 'createdAt'], 'desc')
        .then(() => {
          const criteria = {
            sortBy: [
              ['completedAt', 'desc'],
              ['createdAt', 'desc']
            ]
          };
          expect(repoSearchStub).to.be.calledOnce;
          expect(repoSearchStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSearchStub.firstCall.args[1]).to.eql(criteria);
          expect(repoSearchStub.firstCall.args[2]).to.eql({
            records: config.mongodb.record_max_fetch_count,
            offset: 0
          });
        });
    });
    it('should retrieve history of maintenace for  default criteria', function () {
      inMaintenance = false;
      return maintenanceManager.getMaintenaceHistory()
        .then(() => {
          const criteria = {
            sortBy: [
              ['createdAt', 'desc']
            ]
          };
          expect(repoSearchStub).to.be.calledOnce;
          expect(repoSearchStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.MAINTENANCE_DETAIL);
          expect(repoSearchStub.firstCall.args[1]).to.eql(criteria);
          expect(repoSearchStub.firstCall.args[2]).to.eql({
            records: config.mongodb.record_max_fetch_count,
            offset: 0
          });
        });
    });
  });
});
