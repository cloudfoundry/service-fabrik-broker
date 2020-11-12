'use strict';

const logger = require('@sf/logger');
const MeteringClient = require('../src/MeteringClient');

describe('metering', () => {
  describe('MeteringClient', () => {

    describe('#getAuthToken', () => {
      it('queries the metering service for auth token', () => {
        const mock_token = 'mock_token_string';
        mocks.metering.mockAuthCall(mock_token);
        const metering_client = new MeteringClient();
        return metering_client
          .getAuthToken()
          .then(res => {
            expect(res).to.eql(mock_token);
            return mocks.verify();
          });
      });
      it('should log and throw error if auth fails', () => {
        mocks.metering.mockFailedAuthCall();
        const metering_client = new MeteringClient();
        return metering_client.getAuthToken()
          .catch(err => {
            expect(err.status).to.be.equal(404);
            // expect(err).to.be.an(object);
          });
      });
    });

    describe('#sendUsageRecord', () => {
      it('it should return send request with correct body and auth token', () => {
        const mock_token = 'mock_token_string';
        const mock_usage_record = {
          usage: ['records']
        };
        const mock_response_code = 200;
        mocks.metering.mockAuthCall(mock_token);
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        const metering_client = new MeteringClient();
        return metering_client
          .sendUsageRecord(mock_usage_record)
          .then(res => {
            expect(res.statusCode).to.eql(mock_response_code);
            mocks.verify();
          });
      });
    });

  });
});
