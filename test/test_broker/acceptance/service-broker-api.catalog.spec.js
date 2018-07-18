'use strict';

const app = require('../support/apps').internal;
const config = require('../../../common/config');
const CONST = require('../../../common/constants');


describe('service-broker-api', function () {
  describe('catalog-cf', function () {
    const baseCFUrl = '/cf/v2';

    it('returns 200 Ok', function () {
      return chai.request(app)
        .get(`${baseCFUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .then(res => {
          expect(res).to.have.status(200);
          expect(res.body.services).to.be.instanceof(Array);
          expect(res.body.services).to.have.length(2);
          expect(res.body.services[0].plans).to.have.length(8);
          expect(res.body.services[1].plans).to.have.length(2);
        });
    });

    it('returns 405 Method not allowed', function () {
      return chai.request(app)
        .delete(`${baseCFUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .catch(err => err.response)
        .then(res => {
          expect(res).to.have.status(405);
          expect(res).to.have.header('allow', ['GET']);
        });
    });
  });

  describe('catalog-k8s', function () {
    const baseK8sUrl = '/k8s/v2';

    it('returns 200 Ok', function () {
      return chai.request(app)
        .get(`${baseK8sUrl}/catalog`)
        .set('X-Broker-API-Version', CONST.SF_BROKER_API_VERSION_MIN)
        .auth(config.username, config.password)
        .then(res => {
          expect(res).to.have.status(200);
          expect(res.body.services).to.be.instanceof(Array);
          expect(res.body.services).to.have.length(1);
          expect(res.body.services[0].plans).to.have.length(4);
        });
    });

    it('returns 405 Method not allowed', function () {
      return chai.request(app)
        .delete(`${baseK8sUrl}/catalog`)
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