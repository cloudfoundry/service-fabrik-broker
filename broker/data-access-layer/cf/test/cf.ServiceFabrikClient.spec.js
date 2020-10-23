'use strict';

const _ = require('lodash');
const formatUrl = require('url').format;
const ServiceFabrikClient = require('../src/ServiceFabrikClient');
const { CONST } = require('@sf/common-utils');

const tokenIssuerStub = {
  getAccessToken: () => undefined
};

describe('cf', function () {
  describe('ServiceFabrikClient', function () {
    describe('#BackupOperations', function () {
      /* jshint expr:true */
      const instance_id = '9999-8888-7777-6666';
      const tenant_id = '1111-2222-3333-4444';
      const bearer = 'bearer';
      let body = {
        name: 'backup',
        guid: 'a6b39499-8b8b-4e1b-aaec-b2bc11d396e4'
      };
      let response = {
        statusCode: undefined,
        body: body
      };
      const sfClient = new ServiceFabrikClient(tokenIssuerStub);
      let requestSpy, getAccessTokenSpy;

      function buildExpectedRequestArgs(method, path, statusCode, data, inputBody) {
        const options = {
          method: method,
          url: path,
          auth: false,
          headers: {
            authorization: `Bearer ${bearer}`,
            'Content-type': 'application/json'
          },
          responseType: 'json'
        };
        if (_.isObject(statusCode)) {
          data = statusCode;
          statusCode = undefined;
        }
        if (data) {
          if (_.includes(['GET', 'DELETE'], method)) {
            options.url = formatUrl({
              pathname: options.url,
              query: data
            });
          } else {
            options.data = data;
          }
        }
        _.set(response, 'statusCode', statusCode || 200);
        _.set(response, 'body', inputBody || body);
        return [options, response.statusCode];
      }

      beforeEach(function () {
        requestSpy = sinon.stub(sfClient, 'request');
        requestSpy.returns(Promise.resolve(response));
        getAccessTokenSpy = sinon.stub(tokenIssuerStub, 'getAccessToken');
        getAccessTokenSpy.returns(Promise.resolve(bearer));
      });

      afterEach(function () {
        requestSpy.restore();
        getAccessTokenSpy.restore();
      });

      it('should initiate backup successfully', function () {
        const backupOpts = {
          instance_id: instance_id,
          type: 'online'
        };
        const [options, statusCode] = buildExpectedRequestArgs('POST',
          `/api/v1/service_instances/${instance_id}/backup`,
          202,
          _.omit(backupOpts, 'instance_id'));
        return sfClient.startBackup(backupOpts)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql(body);
          });
      });
      it('should schedule auto-update successfully', function () {
        const payLoad = {
          instance_id: instance_id,
          repeatInterval: '1 1 15 * *'
        };
        const [options, statusCode] = buildExpectedRequestArgs('PUT',
          `/api/v1/service_instances/${instance_id}/schedule_update`,
          201,
          _.omit(payLoad, 'instance_id'));
        return sfClient.scheduleUpdate(payLoad)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql(body);
          });
      });
      it('should retrieve sf info  successfully', function () {
        body = {
          name: 'service-fabrik-broker',
          api_version: '1.0',
          db_status: CONST.DB.STATE.CONNECTED,
          ready: true
        };
        const [options, statusCode] = buildExpectedRequestArgs('GET',
          '/api/v1/info',
          200);
        return sfClient.getInfo()
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql(body);
          });
      });
      it('should abort last backup successfully', function () {
        const backupAbortOpts = {
          instance_guid: instance_id,
          tenant_id: tenant_id
        };
        buildExpectedRequestArgs('DELETE',
          `/api/v1/service_instances/${instance_id}/backup?space_guid%3F${tenant_id}`,
          202, undefined, {});
        return sfClient.abortLastBackup(backupAbortOpts)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledOnce;
            expect(result).to.eql({});
          });
      });
      it('should abort last backup with error', function () {
        const backupAbortOpts = {
          instance_guid: instance_id,
          tenant_id: tenant_id
        };
        buildExpectedRequestArgs('DELETE',
          `/api/v1/service_instances/${instance_id}/backup?space_guid%3F${tenant_id}`,
          204);
        return sfClient.abortLastBackup(backupAbortOpts)
          .catch(err => err)
          .then(res => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledOnce;
            expect(res).to.have.status(500);
            expect(res.name).to.be.eql('InternalServerError');
          });
      });
    });
  });
});
