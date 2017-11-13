'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const formatUrl = require('url').format;
const CloudControllerClient = require('../lib/cf/CloudControllerClient');
const errors = require('../lib/errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const SecurityGroupNotFound = errors.SecurityGroupNotFound;

describe('cf', function () {
  describe('CloudControllerClient', function () {
    /* jshint expr:true */

    const id = 42;
    const guid = 'guid';
    const name = 'name';
    const rules = [];
    const bearer = 'bearer';
    const firstResource = {};
    const resources = [];
    const body = {
      resources: resources,
      entity: {
        space_guid: 'space_guid',
        organization_guid: 'org_guid'
      }
    };
    const response = {
      statusCode: undefined,
      body: body
    };
    const tokenIssuerStub = {
      getAccessToken: () => undefined
    };
    const cloudController = new CloudControllerClient(tokenIssuerStub);
    let requestSpy, getAccessTokenSpy;

    function buildExpectedRequestArgs(method, path, statusCode, data) {
      const options = {
        method: method,
        url: '/v2' + path,
        auth: {
          bearer: bearer
        },
        json: true
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
          options.body = data;
        }
      }
      _.set(response, 'statusCode', statusCode || 200);
      return [options, response.statusCode];
    }

    beforeEach(function () {
      requestSpy = sinon.stub(cloudController, 'request');
      requestSpy.returns(Promise.resolve(response));
      getAccessTokenSpy = sinon.stub(tokenIssuerStub, 'getAccessToken');
      getAccessTokenSpy.returns(Promise.resolve(bearer));
      _.remove(resources, () => true);
    });

    afterEach(function () {
      requestSpy.restore();
      getAccessTokenSpy.restore();
    });

    describe('#getInfo', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', '/info');

      it('should return the JSON body with Status 200', () => {
        _.set(options, 'auth', undefined);
        return cloudController.getInfo()
          .then(result => {
            expect(getAccessTokenSpy).not.to.be.called;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body);
          });
      });
    });

    describe('#getServiceInstances', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', '/service_instances');

      it('should return all JSON body resources with Status 200', function () {
        return cloudController.getServiceInstances()
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql(resources);
          });
      });
    });

    describe('#getServiceInstance', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', `/service_instances/${id}`);

      it('should return the JSON body with Status 200', function () {
        return cloudController.getServiceInstance(id)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body);
          });
      });
    });

    describe('#getServiceInstancePermissions', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', `/service_instances/${id}/permissions`);

      it('should return the JSON body with Status 200', function () {
        return cloudController.getServiceInstancePermissions(id)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body);
          });
      });

      it('should return the JSON body with Status 200 with bearer specified', function () {
        return cloudController.getServiceInstancePermissions(id, {
            auth: {
              bearer: bearer
            }
          })
          .then(result => {
            expect(getAccessTokenSpy).not.to.be.called;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body);
          });
      });
    });

    describe('#getServicePlans', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', '/service_plans');

      it('should return all resources with Status 200', function () {
        return cloudController.getServicePlans()
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql(resources);
          });
      });
    });

    describe('#getServicePlan', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', `/service_plans/${guid}`);

      it('should return the JSON body with Status 200', function () {
        return cloudController.getServicePlan(guid)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body);
          });
      });
    });

    describe('#findServicePlanByInstanceId', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', '/service_plans', {
        q: `service_instance_guid:${id}`
      });

      it('should return the JSON body first resource with Status 200', function () {
        resources.push(firstResource);
        return cloudController.findServicePlanByInstanceId(id)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(firstResource);
          });
      });

      it('should throw a ServiceInstanceNotFound exception', function () {
        return cloudController.findServicePlanByInstanceId(id)
          .then(() => {
            expect.fail('resolve', 'reject', 'Expected promise not to resolve');
          })
          .catch(ServiceInstanceNotFound, () => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
          });
      });
    });

    describe('#findSecurityGroupByName', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', '/security_groups', {
        q: `name:${name}`
      });

      it('should return the JSON body first resource with Status 200', function () {
        resources.push(firstResource);
        return cloudController.findSecurityGroupByName(name)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(firstResource);
          });
      });

      it('should throw a SecurityGroupNotFound exception', function () {
        return cloudController.findSecurityGroupByName(name)
          .then(() => {
            expect.fail('resolve', 'reject', 'Expected promise not to resolve');
          })
          .catch(SecurityGroupNotFound, () => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
          });
      });
    });

    describe('#createSecurityGroup', function () {
      const [options, statusCode] = buildExpectedRequestArgs('POST', '/security_groups', 201, {
        name: name,
        rules: rules,
        space_guids: [guid]
      });

      it('should create a security rule and return the JSON body', function () {
        resources.push(firstResource);
        return cloudController.createSecurityGroup(name, rules, guid)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body);
          });
      });
    });

    describe('#getSecurityGroup', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', `/security_groups/${guid}`);

      it('should return the JSON body with Status 200', function () {
        return cloudController.getSecurityGroup(guid)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body);
          });
      });
    });

    describe('#deleteSecurityGroup', function () {
      const [options, statusCode] = buildExpectedRequestArgs('DELETE', `/security_groups/${guid}`, 204);

      it('should delete a security group and return with Status 204', function () {
        _.set(options, 'qs.async', false);
        return cloudController.deleteSecurityGroup(guid)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.be.undefined;
          });
      });
    });

    describe('#getSpaces', function () {
      const calls = _.range(7);

      function url(i) {
        const firstUrl = '/v2/spaces?results-per-page=1';
        if (i === 0) {
          return firstUrl;
        }
        if (i <= calls.length) {
          return `${firstUrl}&order-direction=asc&page=${i+1}`;
        }
        return null;
      }

      function options(i) {
        return {
          method: 'GET',
          url: url(i),
          auth: {
            bearer: bearer
          },
          json: true
        };
      }

      it('should return all space resources with Status 200', function () {
        const statusCode = 200;
        const resources = _.map(calls, i => _.set({}, 'metadata.guid', i));
        _.each(calls, i => {
          requestSpy.onCall(i).returns({
            statusCode: statusCode,
            body: {
              next_url: url(i + 1),
              resources: [resources[i]]
            }
          });
        });
        return cloudController
          .getSpaces({
            auth: {
              bearer: bearer
            },
            qs: {
              'results-per-page': 1
            }
          })
          .then(result => {
            expect(getAccessTokenSpy).not.to.be.called;
            expect(requestSpy.callCount).to.equal(calls.length + 1);
            _.each(calls, i => {
              expect(requestSpy.getCall(i)).to.be.calledWithExactly(options(i), statusCode);
            });
            expect(result).to.eql(resources);
          });
      });
    });
    describe('#getSpaceGuid', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', `/service_instances/${id}`);

      it('should return the JSON body with Status 200', function () {
        return cloudController.getSpaceGuid(id)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(body.entity.space_guid);
          });
      });
    });

    describe('#getOrgGuid', function () {
      const [options, statusCode] = buildExpectedRequestArgs('GET', `/spaces/${id}`);
      it('should return the JSON body with Status 200', function () {
        return cloudController.getOrgGuid(id)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);

            expect(result).to.equal(body.entity.organization_guid);
          });
      });
    });


  });
});