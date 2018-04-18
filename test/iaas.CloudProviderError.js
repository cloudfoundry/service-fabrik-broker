'use strict';
const lib = require('../broker/lib');
const CloudProviderClient = lib.iaas.CloudProviderClient;

describe('iaas', function () {
  describe('validate not found responses', function () {
    it('code 404 should be considered NotFound', function () {
      expect(CloudProviderClient.providerErrorTypes.NotFound({
        code: 404
      })).to.equal(true);
    });

    it('statusCode  404 should be considered NotFound', function () {
      expect(CloudProviderClient.providerErrorTypes.NotFound({
        statusCode: 404
      })).to.equal(true);
    });

    it('failCode Item not found should be considered NotFound', function () {
      expect(CloudProviderClient.providerErrorTypes.NotFound({
        failCode: 'Item not found'
      })).to.equal(true);
    });

    it('code NotFound should be considered NotFound', function () {
      expect(CloudProviderClient.providerErrorTypes.NotFound({
        code: 'NotFound'
      })).to.equal(true);
    });

  });

  describe('validate Unauthorized responses', function () {
    it('statusCode 401 should be considered Unauthorized', function () {
      expect(CloudProviderClient.providerErrorTypes.Unauthorized({
        statusCode: 401
      })).to.equal(true);
    });

    it('failCode Unauthorized should be considered Unauthorized', function () {
      expect(CloudProviderClient.providerErrorTypes.Unauthorized({
        failCode: 'Unauthorized'
      })).to.equal(true);
    });
  });
});