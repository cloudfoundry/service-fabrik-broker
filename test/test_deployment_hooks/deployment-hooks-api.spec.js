'use strict';

const app = require('./support/apps').hook;
const CONST = require('../../deployment_hooks/lib/constants');
const config = require('./../../deployment_hooks/lib/config');

describe('deployment-hooks', function () {
  /* jshint expr:true */
  describe('actionresponse', function () {
    const base_url = '/hook';

    // before(function () {
    //     return mocks.setup([]);
    // });

    // afterEach(function () {
    //     mocks.reset();
    // });

    describe('#getActionResponse', function () {
      const requestBody = {
        phase: CONST.SERVICE_LIFE_CYCLE.PRE_CREATE,
        actions: ['Blueprint', 'ReserveIps'],
        context: {}
      };
      it('should return 400 Bad Request if phase or actions is invalid', function () {
        return chai
          .request(app)
          .post(`${base_url}`)
          .send({})
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(400);
          });
      });
      it('should return correct response', function () {
        const expectedResBody = {
          Blueprint: {
            precreate_input: {}
          },
          ReserveIps: ['10.244.11.247']
        };
        return chai
          .request(app)
          .post(`${base_url}`)
          .send(requestBody)
          .set('Accept', 'application/json')
          .auth(config.username, config.password)
          .then(res => {
            expect(res.body).to.deep.equal(expectedResBody);
          });
      });
    });
  });
});