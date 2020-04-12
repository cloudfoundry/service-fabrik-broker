'use strict';

const _ = require('lodash');
const assert = require('assert');
const config = require('../../../common/config');
const app = require('../support/apps').external;

describe('service-fabrik-api', function () {
  describe('info', function () {
    const baseUrl = '/api/v1';
    afterEach(function () {
      mocks.reset();
    });

    it('returns 200 Ok', function () {
      mocks.docker.getMissingImages();
      return chai.request(app)
        .get(`${baseUrl}/info`)
        .catch(err => err.response)
        .then(res => {
          assert.ok(res.body.db_status, 'Service fabrik info must return back db status');
          expect(res).to.have.status(200);
          expect(_.omit(res.body, 'db_status')).to.be.eql({
            name: 'service-fabrik-broker',
            api_version: '1.0',
            ready: true
          });
          mocks.verify();
        });
    });
    it('returns 200 Ok if swarm is disabled', function () {
      config.enable_swarm_manager = false;
      return chai.request(app)
        .get(`${baseUrl}/info`)
        .catch(err => err.response)
        .then(res => {
          config.enable_swarm_manager = true;
          assert.ok(res.body.db_status, 'Service fabrik info must return back db status');
          expect(res).to.have.status(200);
          expect(_.omit(res.body, 'db_status')).to.be.eql({
            name: 'service-fabrik-broker',
            api_version: '1.0',
            ready: true
          });
          mocks.verify();
        });
    });
    it('returns 200 Ok if unable to fetch images', function () {
      return chai.request(app)
        .get(`${baseUrl}/info`)
        .catch(err => err.response)
        .then(res => {
          assert.ok(res.body.db_status, 'Service fabrik info must return back db status');
          expect(res).to.have.status(200);
          expect(_.omit(res.body, 'db_status')).to.be.eql({
            name: 'service-fabrik-broker',
            api_version: '1.0',
            ready: false
          });
          mocks.verify();
        });
    });

    it('returns 405 Method not allowed', function () {
      return chai.request(app)
        .delete(`${baseUrl}/info`)
        .catch(err => err.response)
        .then(res => {
          expect(res).to.have.status(405);
          expect(res).to.have.header('allow', ['GET']);
        });
    });
  });
});