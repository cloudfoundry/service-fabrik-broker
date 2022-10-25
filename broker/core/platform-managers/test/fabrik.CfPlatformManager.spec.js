'use strict';

const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const _ = require('lodash');
const CfPlatformManager = require('../src/CfPlatformManager');
const { BasePlatformManager } = require('@sf/platforms');
const { cloudController } = require('@sf/cf');
const assert = require('assert');
const {
  CONST,
  errors: {
    CrossOrganizationSharingNotAllowed,
    InstanceSharingNotAllowed,
    UnprocessableEntity,
    InternalServerError
  }
} = require('@sf/common-utils');
let config = require('@sf/app-config');

describe('fabrik', function () {
  describe('CfPlatformManager', function () {
    describe('feature.EnableSecurityGroupsOps', function () {
      let cfPlatformManager = new CfPlatformManager('cf');
      let prevVal = _.get(config, 'feature.EnableSecurityGroupsOps', true);
      let sandbox, createSecurityGroupStub, deleteSecurityGroupStub, ensureSecurityGroupExistsStub;

      before(function () {
        _.set(config, 'feature.EnableSecurityGroupsOps', false);
        sandbox = sinon.createSandbox();
        createSecurityGroupStub = sandbox.stub(cfPlatformManager, 'createSecurityGroupForInstance');
        createSecurityGroupStub
          .withArgs({
            'dummy': 'dummy'
          })
          .returns(Promise.try(() => {
            return {
              'dummy': 'dummy'
            };
          }));

        deleteSecurityGroupStub = sandbox.stub(cfPlatformManager, 'deleteSecurityGroupForInstance');
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

    describe('#isInstanceSharingRequest', function () {
      let cfPlatformManager = new CfPlatformManager('cf');

      it('should be false for normal service binding', function () {
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
      it('should be true for binding for shared instance', function () {
        let options = {
          bind_resource: {
            space_guid: 'abcd',
            app_guid: 'app'
          },
          context: {
            space_guid: 'source'
          }
        };
        expect(cfPlatformManager.isInstanceSharingRequest(options)).to.equal(true);
      });
      it('should be false for service key', function () {
        let options = {
          bind_resource: {},
          context: {
            space_guid: 'source'
          }
        };
        expect(cfPlatformManager.isInstanceSharingRequest(options)).to.equal(false);
      });
    });

    describe('#isCrossOrganizationSharingAllowed', function () {
      const allow_org_sharing = {
        enable_cross_organization_sharing: true
      };
      const disallow_org_sharing = {
        enable_cross_organization_sharing: false
      };
      const CfPlatformManagerAllowOrgSharing = proxyquire('../src/CfPlatformManager', {
        '@sf/app-config': allow_org_sharing
      });
      const CfPlatformManagerDisallowOrgSharing = proxyquire('../src/CfPlatformManager', {
        '@sf/app-config': disallow_org_sharing
      });
      let getSpaceStub;
      before(function () {
        getSpaceStub = sinon.stub(cloudController, 'getSpace').callsFake(() => {
          return Promise.resolve({
            relationships:{
              organization:{
                data:{
                  guid: 'target'
                }
              }
            }
          });
        });
      });
      after(function () {
        getSpaceStub.restore();
      });

      it('should be true if cross organization sharing is enabled', function () {
        let options = {};
        let cfPlatformManager = new CfPlatformManagerAllowOrgSharing('cf');
        return cfPlatformManager.isCrossOrganizationSharingEnabled(options)
          .then(res => expect(res).to.equal(true));
      });
      it('should be false if cross organization sharing is disabled and cross org binding is received', function () {
        let options = {
          bind_resource: {
            space_guid: 'abcd',
            app_guid: 'app'
          },
          context: {
            space_guid: 'source',
            organization_guid: 'source'
          }
        };
        let cfPlatformManager = new CfPlatformManagerDisallowOrgSharing('cf');
        return cfPlatformManager.isCrossOrganizationSharingEnabled(options)
          .catch(err => {
            expect(err instanceof CrossOrganizationSharingNotAllowed).to.equal(true);
          });
      });
      it('should be true if cross organization sharing is disabled and same org binding is received', function () {
        let options = {
          bind_resource: {
            space_guid: 'abcd',
            app_guid: 'app'
          },
          context: {
            space_guid: 'source',
            organization_guid: 'target'
          }
        };
        let cfPlatformManager = new CfPlatformManagerDisallowOrgSharing('cf');
        return cfPlatformManager.isCrossOrganizationSharingEnabled(options)
          .then(res => {
            expect(res).to.equal(true);
          });
      });
    });

    describe('#postBindOperations', function () {
      const cfPlatformManager = new CfPlatformManager('cf');

      it('should create security group for sharing', () => {
        cfPlatformManager.isInstanceSharingRequest = () => true;
        cfPlatformManager.createSecurityGroupForShare = () => Promise.resolve(123);

        return cfPlatformManager.postBindOperations({})
          .then(res => {
            expect(res).to.equal(123);
          });
      });

      it('should not create security group for non-sharing', () => {
        cfPlatformManager.isInstanceSharingRequest = () => false;
        cfPlatformManager.createSecurityGroupForShare = () => Promise.resolve(123);

        return cfPlatformManager.postBindOperations({})
          .then(res => {
            expect(res).to.not.equal(123);
          });
      });
    });

    describe('#preBindOperations', function () {
      const allowSharingConfig = {
        feature: {
          AllowInstanceSharing: true
        }
      };
      const disallowSharingConfig = {
        feature: {
          AllowInstanceSharing: false
        }
      };
      const CfPlatformManagerAllowSharing = proxyquire('../src/CfPlatformManager', {
        '@sf/app-config': allowSharingConfig
      });
      const CfPlatformManagerDisallowSharing = proxyquire('../src/CfPlatformManager', {
        '@sf/app-config': disallowSharingConfig
      });

      it('should run successfully for shared instance and enabled sharing', function () {
        let cfPlatformManager = new CfPlatformManagerAllowSharing('cf');
        cfPlatformManager.isInstanceSharingRequest = () => true;
        cfPlatformManager.isCrossOrganizationSharingEnabled = () => Promise.resolve(true);
        return cfPlatformManager.preBindOperations({});
      });

      it('should run successfully for non-shared instance and enabled sharing', function () {
        let cfPlatformManager = new CfPlatformManagerAllowSharing('cf');
        cfPlatformManager.isInstanceSharingRequest = () => false;
        return cfPlatformManager.preBindOperations({});
      });

      it('should fail for enabled sharing and invalid sharing request', function () {
        let cfPlatformManager = new CfPlatformManagerAllowSharing('cf');
        cfPlatformManager.isInstanceSharingRequest = () => true;
        cfPlatformManager.isCrossOrganizationSharingEnabled = () => Promise.reject(new CrossOrganizationSharingNotAllowed());
        return cfPlatformManager.preBindOperations({})
          .catch(err => {
            expect(err instanceof CrossOrganizationSharingNotAllowed).to.equal(true);
          });
      });

      it('should fail for disabled sharing and invalid sharing request', function () {
        let cfPlatformManager = new CfPlatformManagerDisallowSharing('cf');
        cfPlatformManager.isInstanceSharingRequest = () => true;
        return cfPlatformManager.preBindOperations({})
          .catch(err => {
            expect(err instanceof InstanceSharingNotAllowed).to.equal(true);
          });
      });
    });

    describe('multiAzEnablement', function () {
      const multi_az_internal_config = {
        multi_az_enabled: CONST.INTERNAL,
        quota: {
          whitelist: ['test']
        }
      };
      const CfPlatformManagerInternal = proxyquire('../src/CfPlatformManager', {
        '@sf/app-config': multi_az_internal_config
      });
      const BasePlatformManagerInternal = proxyquire('../src/BasePlatformManager', {
        '@sf/app-config': multi_az_internal_config
      });
      const multi_az_all_config = {
        multi_az_enabled: CONST.ALL
      };

      const multi_az_all_config_wrong = {
        multi_az_enabled: 'INCORRECT_VAL'
      };
      const CfPlatformManagerExterrnal = proxyquire('../src/CfPlatformManager', {
        '@sf/app-config': multi_az_all_config
      });
      const BasePlatformManagerExterrnal = proxyquire('../src/BasePlatformManager', {
        '@sf/app-config': multi_az_all_config
      });
      const CfPlatformManagerWrongConfig = proxyquire('../src/CfPlatformManager', {
        '@sf/app-config': multi_az_all_config_wrong
      });
      const BasePlatformManagerWrongConfig = proxyquire('../src/BasePlatformManager', {
        '@sf/app-config': multi_az_all_config_wrong
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
        getOrgStub = sinon.stub(cloudController, 'getOrganization').callsFake(() => {
          return Promise.resolve({
            name: 'test'
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
            throw new InternalServerError('CFPlatformManager must throw an error when input invalid config...');
          })
          .catch(UnprocessableEntity, () => {})
          .then(() => basePlatformManager.isMultiAzDeploymentEnabled(options))
          .then(() => {
            throw new InternalServerError('BasePlatformManager must throw an error when input invalid config...');
          })
          .catch(UnprocessableEntity, () => {});
      });
    });
  });
});
