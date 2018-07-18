'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const CfPlatformManager = require('../../broker/lib/fabrik/CfPlatformManager');
const assert = require('assert');
let config = require('../../common/config');

describe('fabrik', function () {
  describe('CfPlatformManager', function () {
    describe('feature.EnableSecurityGroupsOps', function () {
      let cfPlatformManager = new CfPlatformManager('cf');
      let prevVal = _.get(config, 'feature.EnableSecurityGroupsOps', true);
      let sandbox, createSecurityGroupStub, deleteSecurityGroupStub, ensureSecurityGroupExistsStub;

      before(function () {

        _.set(config, 'feature.EnableSecurityGroupsOps', false);
        sandbox = sinon.sandbox.create();
        createSecurityGroupStub = sandbox.stub(cfPlatformManager, 'createSecurityGroup');
        createSecurityGroupStub
          .withArgs({
            'dummy': 'dummy'
          })
          .returns(Promise.try(() => {
            return {
              'dummy': 'dummy'
            };
          }));

        deleteSecurityGroupStub = sandbox.stub(cfPlatformManager, 'deleteSecurityGroup');
        deleteSecurityGroupStub
          .withArgs({
            'dummy': 'dummy'
          })
          .returns(Promise.try(() => {
            return {
              'dummy': 'dummy'
            };
          }));

        ensureSecurityGroupExistsStub = sandbox.stub(cfPlatformManager, 'ensureSecurityGroupExists');
        ensureSecurityGroupExistsStub
          .withArgs({
            'dummy': 'dummy'
          })
          .returns(Promise.try(() => {
            return {
              'dummy': 'dummy'
            };
          }));

      });

      after(function () {
        _.set(config, 'feature.EnableSecurityGroupsOps', prevVal);
        sandbox.restore();
      });

      it('should not make call to createSecurityGroup when EnableSecurityGroupsOps set to false', function () {
        return cfPlatformManager
          .postInstanceProvisionOperations({
            'dummy': 'dummy'
          })
          .then(() => {
            assert(!createSecurityGroupStub.called);
          });
      });

      it('should not make call to deleteSecurityGroup when EnableSecurityGroupsOps set to false', function () {
        return cfPlatformManager
          .preInstanceDeleteOperations({
            'dummy': 'dummy'
          })
          .then(() => {
            assert(!deleteSecurityGroupStub.called);
          });
      });

      it('should not make call to ensureSecurityGroupExists when EnableSecurityGroupsOps set to false', function () {
        return cfPlatformManager
          .postInstanceUpdateOperations({
            'dummy': 'dummy'
          })
          .then(() => {
            assert(!ensureSecurityGroupExistsStub.called);
          });
      });
    });

    describe('#buildSecurityGroupRules', function () {
      let cfPlatformManager = new CfPlatformManager('cf');

      it('should return single port rule', function () {
        let options = {
          protocol: 'tcp',
          ips: ['10.11.20.248', '10.11.20.255'],
          applicationAccessPorts: ['8080']
        };

        let rules = cfPlatformManager.buildSecurityGroupRules(options);
        assert(rules.protocol === 'tcp');
        assert(rules.destination === '10.11.20.248-10.11.20.255');
        assert(rules.ports === '8080');
      });

      it('should return comma separated port rule', function () {
        let options = {
          protocol: 'tcp',
          ips: ['10.11.20.248', '10.11.20.255'],
          applicationAccessPorts: ['8080', '8081', '8082']
        };
        let rules = cfPlatformManager.buildSecurityGroupRules(options);
        assert(rules.protocol === 'tcp');
        assert(rules.destination === '10.11.20.248-10.11.20.255');
        assert(rules.ports === '8080,8081,8082');
      });

      it('should handle empty applicationAccessPorts', function () {
        let options = {
          protocol: 'tcp',
          ips: ['10.11.20.248', '10.11.20.255'],
          applicationAccessPorts: undefined
        };

        let rules = cfPlatformManager.buildSecurityGroupRules(options);
        assert(rules.protocol === 'tcp');
        assert(rules.destination === '10.11.20.248-10.11.20.255');
        assert(rules.ports === '1024-65535');
      });
    });
  });
});