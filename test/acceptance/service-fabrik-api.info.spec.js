'use strict';

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
          expect(res).to.have.status(200);
          expect(res.body).to.be.eql({
            name: 'service-fabrik-broker',
            api_version: '1.0',
            ready: true
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