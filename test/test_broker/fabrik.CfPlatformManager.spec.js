'use strict';

const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const _ = require('lodash');
const CfPlatformManager = require('../../platform-managers/CfPlatformManager');
const BasePlatformManager = require('../../platform-managers/BasePlatformManager');
const cloudController = require('../../data-access-layer/cf').cloudController;
const assert = require('assert');
const errors = require('../../common/errors');
let config = require('../../common/config');
let CONST = require('../../common/constants');

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

    describe('#bindOperations', function(){
      let cfPlatformManager = new CfPlatformManager('cf');

      it('should be true if binding is for shared instance', function(){
        let options = {
          bind_resource: {
            space_guid: 'abcd',
            app_guid: 'app'
          },
          context: {
            space_guid: 'abcd'
          }
        };
        expect(cfPlatformManager.isInstanceSharingRequest(options)).to.equal(false);
      });
    });

    describe('multiAzEnablement', function () {
      const multi_az_internal_config = {
        multi_az_enabled: CONST.INTERNAL,
        quota: {
          whitelist: ['test']
        }
      };
      const CfPlatformManagerInternal = proxyquire('../../platform-managers/CfPlatformManager', {
        '../common/config': multi_az_internal_config
      });
      const BasePlatformManagerInternal = proxyquire('../../platform-managers/BasePlatformManager', {
        '../common/config': multi_az_internal_config
      });
      const multi_az_all_config = {
        multi_az_enabled: CONST.ALL
      };

      const multi_az_all_config_wrong = {
        multi_az_enabled: 'INCORRECT_VAL'
      };
      const CfPlatformManagerExterrnal = proxyquire('../../platform-managers/CfPlatformManager', {
        '../common/config': multi_az_all_config
      });
      const BasePlatformManagerExterrnal = proxyquire('../../platform-managers/BasePlatformManager', {
        '../common/config': multi_az_all_config
      });
      const CfPlatformManagerWrongConfig = proxyquire('../../platform-managers/CfPlatformManager', {
        '../common/config': multi_az_all_config_wrong
      });
      const BasePlatformManagerWrongConfig = proxyquire('../../platform-managers/BasePlatformManager', {
        '../common/config': multi_az_all_config_wrong
      });
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
      const options = {
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        }
      };

      let getOrgStub;
      before(function () {
        getOrgStub = sinon.stub(cloudController, 'getOrganization', () => {
          return Promise.resolve({
            entity: {
              name: 'test'
            }
          });
        });
      });
      after(function () {
        getOrgStub.restore();
      });

      it('should return false for multi-az enabled for all customers', function () {
        const defaultCfPlatformManager = new CfPlatformManager('cf');
        const defaultBasePlatformManager = new BasePlatformManager('cf');
        return defaultCfPlatformManager.isMultiAzDeploymentEnabled(options)
          .then(response => expect(response).to.equal(false))
          .then(() => defaultBasePlatformManager.isMultiAzDeploymentEnabled(options))
          .then(response => expect(response).to.equal(false));
      });
      it('should return true for multi-az enabled for all customers', function () {
        const cfPlatformManager = new CfPlatformManagerExterrnal('cf');
        const basePlatformManager = new BasePlatformManagerExterrnal('cf');
        return cfPlatformManager.isMultiAzDeploymentEnabled(options)
          .then(response => expect(response).to.equal(true))
          .then(() => basePlatformManager.isMultiAzDeploymentEnabled(options))
          .then(response => expect(response).to.equal(true));
      });
      it('should return true for multi-az enabled for internal customers', function () {
        const cfPlatformManager = new CfPlatformManagerInternal('cf');
        const basePlatformManager = new BasePlatformManagerInternal('cf');
        return cfPlatformManager.isMultiAzDeploymentEnabled(options)
          .then(response => expect(response).to.equal(true))
          .then(() => basePlatformManager.isMultiAzDeploymentEnabled(options))
          .then(response => expect(response).to.equal(true));
      });
      it('should throw error on setting in correct value for config - multi_az_enabled', function () {
        const cfPlatformManager = new CfPlatformManagerWrongConfig('cf');
        const basePlatformManager = new BasePlatformManagerWrongConfig('cf');
        return cfPlatformManager.isMultiAzDeploymentEnabled(options)
          .then(() => {
            throw new errors.InternalServerError('CFPlatformManager must throw an error when input invalid config...');
          })
          .catch(errors.UnprocessableEntity, () => {})
          .then(() => basePlatformManager.isMultiAzDeploymentEnabled(options))
          .then(() => {
            throw new errors.InternalServerError('BasePlatformManager must throw an error when input invalid config...');
          })
          .catch(errors.UnprocessableEntity, () => {});
      });
    });
  });
});