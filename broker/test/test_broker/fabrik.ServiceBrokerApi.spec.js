'use strict';

const api = require('../../applications/osb-broker/src/api-controllers').serviceBrokerApi;
const {
  commonFunctions: {
    isValidKubernetesName
  },
  errors: {
    PreconditionFailed,
    ContinueWithNext
  }
} = require('@sf/common-utils');

describe('fabrik', function () {
  describe('ServiceBrokerApi', function () {
    describe('#apiVersion', function () {

      const req = {
        headers: {
          'x-broker-api-version': 2.7
        }
      };
      const res = {};

      function expectToThrow(clazz) {
        return new Error(`Expected error '${clazz.name}' has not been thrown`);
      }

      it('should abort with a PreconditionFailed error when version is 2.7', function () {
        req.headers['x-broker-api-version'] = '2.7';
        return api
          .apiVersion(req, res)
          .throw(expectToThrow(PreconditionFailed))
          .catch(err => expect(err).to.be.instanceof(PreconditionFailed));
      });

      it('should abort with a PreconditionFailed error when version is 2.8', function () {
        req.headers['x-broker-api-version'] = '2.8';
        return api
          .apiVersion(req, res)
          .throw(expectToThrow(PreconditionFailed))
          .catch(err => expect(err).to.be.instanceof(PreconditionFailed));
      });

      it('For CF : should abort with a PreconditionFailed error when version is 2.11', function () {
        req.headers['x-broker-api-version'] = '2.11';
        req.params = {
          platform: 'cf'
        };
        return api
          .apiVersion(req, res)
          .throw(expectToThrow(PreconditionFailed))
          .catch(err => expect(err).to.be.instanceof(PreconditionFailed));
      });

      it('For K8S : should abort with a PreconditionFailed error when version is 2.11', function () {
        req.headers['x-broker-api-version'] = '2.11';
        req.params = {
          platform: 'k8s'
        };
        return api
          .apiVersion(req, res)
          .throw(expectToThrow(PreconditionFailed))
          .catch(err => expect(err).to.be.instanceof(PreconditionFailed));
      });

      it('should call the next handler when version is 2.12', function () {
        req.headers['x-broker-api-version'] = '2.12';
        return api
          .apiVersion(req, res)
          .throw(expectToThrow(ContinueWithNext))
          .catch(err => expect(err).to.be.instanceof(ContinueWithNext));
      });

    });

    describe('#getKubernetesName', function () {
      it('should return the same name if the name is valid', function () {
        const str = 'abcd.1234-efgh';
        expect(isValidKubernetesName(str)).to.be.true;
        expect(api.getKubernetesName(str)).to.eql(str);
      });

      it('should return a valid name if it is invalid starting with -', function () {
        const str = '-abcd1234';
        expect(isValidKubernetesName(str)).to.be.false;
        const res = api.getKubernetesName(str)
        expect(res).not.to.eql(str);
        expect(isValidKubernetesName(res)).to.be.true;
      });

      it('should return a valid name if it is invalid starting with .', function () {
        const str = '.abcd1234';
        expect(isValidKubernetesName(str)).to.be.false;
        const res = api.getKubernetesName(str)
        expect(res).not.to.eql(str);
        expect(isValidKubernetesName(res)).to.be.true;
      });

      it('should return a valid name if it is invalid with upper case', function () {
        const str = 'abcD.1234';
        expect(isValidKubernetesName(str)).to.be.false;
        const res = api.getKubernetesName(str)
        expect(res).not.to.eql(str);
        expect(isValidKubernetesName(res)).to.be.true;
      });
    });
  });
});
