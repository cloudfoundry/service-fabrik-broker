'use strict';

const lib = require('../../broker/lib');
const app = require('../support/apps').report;
const config = lib.config;

describe('service-fabrik-report', function () {
  /* jshint expr:true */
  describe('backupreport', function () {
    const base_url = '/admin/report';
    const start_time = '2017-11-09';
    const end_time = '2017-11-26';
    const instance_id = '9999-8888-7777-6666';

    before(function () {
      return mocks.setup([]);
    });

    afterEach(function () {
      mocks.reset();
    });

    describe('#getServiceInstanceBackupSummary', function () {
      it('should return 404 Bad Request if start_time is invalid', function () {
        return chai
          .request(app)
          .get(`${base_url}/backups/summary/${instance_id}`)
          .query({
            start_time: 'invalid-date',
            end_time: end_time
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });

      it('should return 404 Bad Request if end_time is invalid', function () {
        return chai
          .request(app)
          .get(`${base_url}/backups/summary/${instance_id}`)
          .query({
            start_time: start_time,
            end_time: 'invalid-date'
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });
    });

    describe('#getScheduledBackupInstances', function () {
      it('should return 404 Bad Request if start_time is invalid', function () {
        return chai
          .request(app)
          .get(`${base_url}/backups/scheduled_instances`)
          .query({
            start_time: 'invalid-date',
            end_time: end_time
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });

      it('should return 404 Bad Request if end_time is invalid', function () {
        return chai
          .request(app)
          .get(`${base_url}/backups/scheduled_instances`)
          .query({
            start_time: start_time,
            end_time: 'invalid-date'
          })
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });
    });
  });
});