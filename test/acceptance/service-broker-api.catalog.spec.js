'use strict';

const lib = require('../../lib');
const app = require('../support/apps').internal;
const config = lib.config;
const CONST = require('../../lib/constants');


describe('service-broker-api', function () {
  describe('catalog', function () {
    const baseUrl = '/cf/v2';

    it('returns 200 Ok', function () {
      return chai.request(app)
        .get(`${baseUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .then(res => {
          expect(res).to.have.status(200);
          expect(res.body.services).to.be.instanceof(Array);
          expect(res.body.services).to.have.length(2);
        });
    });

    it('returns 405 Method not allowed', function () {
      return chai.request(app)
        .delete(`${baseUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .catch(err => err.response)
        .then(res => {
          expect(res).to.have.status(405);
          expect(res).to.have.header('allow', ['GET']);
        });
    });
  });
});