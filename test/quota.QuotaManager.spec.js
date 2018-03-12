'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const quota = require('../lib/quota');
const proxyquire = require('proxyquire');
const quotaManager = quota.quotaManager;
const catalog = require('../lib/models/catalog');
const CloudControllerClient = require('../lib/cf/CloudControllerClient');


describe('quota', () => {
  describe('QuotaManager', () => {
    describe('getPlanGuidFromPlanID', () => {
      let sandbox, getServicePlansStub;
      const planId = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const servicePlans = [{
        'metadata': {
          'guid': 'c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'url': '/v2/service_plans/c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'created_at': '2017-03-20T09:46:57Z',
          'updated_at': '2017-03-20T09:47:15Z'
        },
        'entity': {
          'name': 'v1.0-xsmall',
          'free': false,
          'description': 'Blueprint 1.0 service x-small (managed service in beta)',
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'extra': '{\'costs\':[{\'amount\':{\'usd\':0},\'unit\':\'MONTHLY\'}],\'bullets\':[\'Dedicated Deployment\',\'1 VM\',\'1 vCPUs\',\'1 GB Memory\',\'1 GB Disk\'],\'supported_features\':[\'state\',\'lifecycle\',\'credentials\',\'backup\',\'restore\']}',
          'unique_id': 'bc158c9a-7934-401e-94ab-057082a5073f',
          'public': true,
          'bindable': true,
          'active': true,
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'service_instances_url': '/v2/service_plans/c77ff479-ea63-42ea-b6d1-d824c4012f1c/service_instances'
        }
      }];
      before(function () {
        sandbox = sinon.sandbox.create();
        getServicePlansStub = sandbox.stub(CloudControllerClient.prototype, 'getServicePlans');
        getServicePlansStub.withArgs(`unique_id:${planId}`).returns(Promise.resolve(servicePlans));
      });
      afterEach(function () {
        getServicePlansStub.reset();
      });
      after(function () {
        sandbox.restore();
      });

      it('returns a valid service plan guid when provided a unique plan id', () => {
        return quotaManager.getPlanGuidFromPlanID(planId)
          .then(value => {
            expect(value).to.eql('c77ff479-ea63-42ea-b6d1-d824c4012f1c');
          });
      });
    });

    describe('getAllPlanGuidsFromPlanIDs', () => {
      let sandbox, getServicePlansStub;
      const planId = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const planId2 = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
      const planIds = [planId, planId2];
      const servicePlans = [{
        'metadata': {
          'guid': 'c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'url': '/v2/service_plans/c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'created_at': '2017-03-20T09:46:57Z',
          'updated_at': '2017-03-20T09:47:15Z'
        },
        'entity': {
          'name': 'v1.0-xsmall',
          'free': false,
          'description': 'Blueprint 1.0 service x-small (managed service in beta)',
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'extra': '{\'costs\':[{\'amount\':{\'usd\':0},\'unit\':\'MONTHLY\'}],\'bullets\':[\'Dedicated Deployment\',\'1 VM\',\'1 vCPUs\',\'1 GB Memory\',\'1 GB Disk\'],\'supported_features\':[\'state\',\'lifecycle\',\'credentials\',\'backup\',\'restore\']}',
          'unique_id': 'bc158c9a-7934-401e-94ab-057082a5073f',
          'public': true,
          'bindable': true,
          'active': true,
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'service_instances_url': '/v2/service_plans/c77ff479-ea63-42ea-b6d1-d824c4012f1c/service_instances'
        }
      }];

      const servicePlans2 = [{
        'metadata': {
          'guid': 'cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'url': '/v2/service_plans/cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'created_at': '2017-03-20T09:46:57Z',
          'updated_at': '2017-03-20T09:47:15Z'
        },
        'entity': {
          'name': 'v1.0-large',
          'free': false,
          'description': 'Blueprint 1.0 service large (managed service in beta)',
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'extra': '{\'costs\':[{\'amount\':{\'usd\':0},\'unit\':\'MONTHLY\'}],\'bullets\':[\'Dedicated Deployment\',\'1 VM\',\'1 vCPUs\',\'1 GB Memory\',\'2 GB Disk\'],\'update_predecessors\':[\'bc158c9a-7934-401e-94ab-057082a5073f\'],\'supported_features\':[\'state\',\'lifecycle\',\'credentials\',\'backup\',\'restore\']}',
          'unique_id': 'd616b00a-5949-4b1c-bc73-0d3c59f3954a',
          'public': true,
          'bindable': true,
          'active': true,
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'service_instances_url': '/v2/service_plans/cb862bfe-3a50-4d12-a8e2-156d6e11bed4/service_instances'
        }
      }];
      before(function () {
        sandbox = sinon.sandbox.create();
        getServicePlansStub = sandbox.stub(CloudControllerClient.prototype, 'getServicePlans');
        getServicePlansStub.withArgs(`unique_id:${planId}`).returns(Promise.resolve(servicePlans)).withArgs(`unique_id:${planId2}`).returns(Promise.resolve(servicePlans2));
      });
      afterEach(function () {
        getServicePlansStub.reset();
      });
      after(function () {
        sandbox.restore();
      });

      it('returns a list of valid service plan guids from a list of plan ids', () => {
        return quotaManager.getAllPlanGuidsFromPlanIDs(planIds)
          .then(value => {
            expect(value).to.eql(['c77ff479-ea63-42ea-b6d1-d824c4012f1c', 'cb862bfe-3a50-4d12-a8e2-156d6e11bed4']);
          });
      });
    });


    describe('checkQuota', () => {
      const QuotaManager = proxyquire('../lib/quota/QuotaManager', {
        '../config': {
          quota: {
            enabled: true,
            whitelist: ['SAP_UAA', 'SAP_provisioning']
          }
        }
      });

      const quotaAPIClientStub = {
        getQuota: () => undefined
      };

      const quotaManager = new QuotaManager(quotaAPIClientStub);

      let sandbox, getOrganizationStub, getServicePlansStub, getQuotaStub, getServiceInstancesStub, isOrgWhitelistedStub;
      const orgId = '63125bbc-81fe-46c3-9437-e5a8a6594774';
      const planName = 'v1.0-small';
      const serviceName = 'blueprint';

      const org = {
        'metadata': {
          'guid': '63125bbc-81fe-46c3-9437-e5a8a6594774',
          'url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774',
          'created_at': '2017-03-20T09:46:06Z',
          'updated_at': '2017-03-20T09:46:06Z'
        },
        'entity': {
          'name': 'dev',
          'billing_enabled': false,
          'quota_definition_guid': '12badf80-06cb-484b-94ce-556e5e02de60',
          'status': 'active',
          'default_isolation_segment_guid': null,
          'quota_definition_url': '/v2/quota_definitions/12badf80-06cb-484b-94ce-556e5e02de60',
          'spaces_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/spaces',
          'domains_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/domains',
          'private_domains_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/private_domains',
          'users_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/users',
          'managers_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/managers',
          'billing_managers_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/billing_managers',
          'auditors_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/auditors',
          'app_events_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/app_events',
          'space_quota_definitions_url': '/v2/organizations/63125bbc-81fe-46c3-9437-e5a8a6594774/space_quota_definitions'
        }
      };
      const smallPlanId = 'bc158c9a-7934-401e-94ab-057082a5073e';
      const xsmallPlanId = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const smallPlanGuid = 'c77ff479-ea63-42ea-b6d1-d824c4012f1c';
      const rabbitmqVirtualHostPlanGuid = 'd035f948-5d3a-43d7-9aec-954e134c3e9d';
      const smallServicePlan = [{
        'metadata': {
          'guid': 'c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'url': '/v2/service_plans/c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'created_at': '2017-03-20T09:46:57Z',
          'updated_at': '2017-03-20T09:47:15Z'
        },
        'entity': {
          'name': 'v1.0-small',
          'free': false,
          'description': 'Blueprint 1.0 service small (managed service in beta)',
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'extra': '{\'costs\':[{\'amount\':{\'usd\':0},\'unit\':\'MONTHLY\'}],\'bullets\':[\'Dedicated Deployment\',\'1 VM\',\'1 vCPUs\',\'1 GB Memory\',\'1 GB Disk\'],\'supported_features\':[\'state\',\'lifecycle\',\'credentials\',\'backup\',\'restore\']}',
          'unique_id': 'bc158c9a-7934-401e-94ab-057082a5073e',
          'public': true,
          'bindable': true,
          'active': true,
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'service_instances_url': '/v2/service_plans/c77ff479-ea63-42ea-b6d1-d824c4012f1c/service_instances'
        }
      }];
      const xsmallServicePlan = [{
        'metadata': {
          'guid': 'cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'url': '/v2/service_plans/cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'created_at': '2017-03-20T09:46:57Z',
          'updated_at': '2017-03-20T09:47:15Z'
        },
        'entity': {
          'name': 'v1.0-xsmall',
          'free': false,
          'description': 'Blueprint 1.0 service x-small (managed service in beta)',
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'extra': '{\'costs\':[{\'amount\':{\'usd\':0},\'unit\':\'MONTHLY\'}],\'bullets\':[\'Dedicated Deployment\',\'1 VM\',\'1 vCPUs\',\'1 GB Memory\',\'1 GB Disk\'],\'supported_features\':[\'state\',\'lifecycle\',\'credentials\',\'backup\',\'restore\']}',
          'unique_id': 'bc158c9a-7934-401e-94ab-057082a5073f',
          'public': true,
          'bindable': true,
          'active': true,
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'service_instances_url': '/v2/service_plans/cb862bfe-3a50-4d12-a8e2-156d6e11bed4/service_instances'
        }
      }];

      const serviceInstances = [{
        'metadata': {
          'guid': 'cbf07265-1bb9-4eae-bb8f-cef39534d045',
          'url': '/v2/service_instances/cbf07265-1bb9-4eae-bb8f-cef39534d045',
          'created_at': '2017-03-20T09:50:03Z',
          'updated_at': '2017-03-20T09:50:03Z'
        },
        'entity': {
          'name': 'bp01',
          'credentials': {},
          'service_plan_guid': 'c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'space_guid': '6b48f3ea-0ef1-44eb-9de4-942d89779d37',
          'gateway_data': null,
          'dashboard_url': 'https://service-fabrik-broker.bosh-lite.com/manage/instances/24731fb8-7b84-4f57-914f-c3d55d793dd4/bc158c9a-7934-401e-94ab-057082a5073f/cbf07265-1bb9-4eae-bb8f-cef39534d045',
          'type': 'managed_service_instance',
          'last_operation': {
            'type': 'create',
            'state': 'succeeded',
            'description': 'Create deployment service-fabrik-0003-cbf07265-1bb9-4eae-bb8f-cef39534d045 succeeded at 2017-03-20T09:50:34.000Z',
            'updated_at': '2017-03-20T09:51:04Z',
            'created_at': '2017-03-20T09:50:03Z'
          },
          'tags': [],
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'space_url': '/v2/spaces/6b48f3ea-0ef1-44eb-9de4-942d89779d37',
          'service_plan_url': '/v2/service_plans/c77ff479-ea63-42ea-b6d1-d824c4012f1c',
          'service_bindings_url': '/v2/service_instances/cbf07265-1bb9-4eae-bb8f-cef39534d045/service_bindings',
          'service_keys_url': '/v2/service_instances/cbf07265-1bb9-4eae-bb8f-cef39534d045/service_keys',
          'routes_url': '/v2/service_instances/cbf07265-1bb9-4eae-bb8f-cef39534d045/routes',
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34'
        }
      }, {
        'metadata': {
          'guid': '001ca5e5-2aeb-47c5-a063-567bdfe942ec',
          'url': '/v2/service_instances/001ca5e5-2aeb-47c5-a063-567bdfe942ec',
          'created_at': '2017-03-20T09:51:35Z',
          'updated_at': '2017-03-20T09:51:35Z'
        },
        'entity': {
          'name': 'bp02',
          'credentials': {},
          'service_plan_guid': 'cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'space_guid': '6b48f3ea-0ef1-44eb-9de4-942d89779d37',
          'gateway_data': null,
          'dashboard_url': 'https://service-fabrik-broker.bosh-lite.com/manage/instances/24731fb8-7b84-4f57-914f-c3d55d793dd4/d616b00a-5949-4b1c-bc73-0d3c59f3954a/001ca5e5-2aeb-47c5-a063-567bdfe942ec',
          'type': 'managed_service_instance',
          'last_operation': {
            'type': 'create',
            'state': 'succeeded',
            'description': 'Create deployment service-fabrik-0029-001ca5e5-2aeb-47c5-a063-567bdfe942ec succeeded at 2017-03-20T09:52:07.000Z',
            'updated_at': '2017-03-20T09:52:41Z',
            'created_at': '2017-03-20T09:51:35Z'
          },
          'tags': [],
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'space_url': '/v2/spaces/6b48f3ea-0ef1-44eb-9de4-942d89779d37',
          'service_plan_url': '/v2/service_plans/cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'service_bindings_url': '/v2/service_instances/001ca5e5-2aeb-47c5-a063-567bdfe942ec/service_bindings',
          'service_keys_url': '/v2/service_instances/001ca5e5-2aeb-47c5-a063-567bdfe942ec/service_keys',
          'routes_url': '/v2/service_instances/001ca5e5-2aeb-47c5-a063-567bdfe942ec/routes',
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34'
        }
      }, {
        'metadata': {
          'guid': '5f8cadbb-7958-41b2-b5a5-54907c763f1e',
          'url': '/v2/service_instances/5f8cadbb-7958-41b2-b5a5-54907c763f1e',
          'created_at': '2017-03-21T04:15:49Z',
          'updated_at': '2017-03-21T04:15:49Z'
        },
        'entity': {
          'name': 'bp03',
          'credentials': {},
          'service_plan_guid': 'cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'space_guid': '6b48f3ea-0ef1-44eb-9de4-942d89779d37',
          'gateway_data': null,
          'dashboard_url': 'https://service-fabrik-broker.bosh-lite.com/manage/instances/24731fb8-7b84-4f57-914f-c3d55d793dd4/d616b00a-5949-4b1c-bc73-0d3c59f3954a/5f8cadbb-7958-41b2-b5a5-54907c763f1e',
          'type': 'managed_service_instance',
          'last_operation': {
            'type': 'create',
            'state': 'succeeded',
            'description': 'Create deployment service-fabrik-0002-5f8cadbb-7958-41b2-b5a5-54907c763f1e succeeded at 2017-03-21T04:16:22.000Z',
            'updated_at': '2017-03-21T04:16:54Z',
            'created_at': '2017-03-21T04:15:49Z'
          },
          'tags': [],
          'service_guid': 'fe503379-832b-4d56-ad12-3a6ef68dcb34',
          'space_url': '/v2/spaces/6b48f3ea-0ef1-44eb-9de4-942d89779d37',
          'service_plan_url': '/v2/service_plans/cb862bfe-3a50-4d12-a8e2-156d6e11bed4',
          'service_bindings_url': '/v2/service_instances/5f8cadbb-7958-41b2-b5a5-54907c763f1e/service_bindings',
          'service_keys_url': '/v2/service_instances/5f8cadbb-7958-41b2-b5a5-54907c763f1e/service_keys',
          'routes_url': '/v2/service_instances/5f8cadbb-7958-41b2-b5a5-54907c763f1e/routes',
          'service_url': '/v2/services/fe503379-832b-4d56-ad12-3a6ef68dcb34'
        }
      }];

      before(function () {
        sandbox = sinon.sandbox.create();
        getQuotaStub = sandbox.stub(quotaAPIClientStub, 'getQuota');
        getOrganizationStub = sandbox.stub(CloudControllerClient.prototype, 'getOrganization');
        getOrganizationStub.withArgs(orgId).returns(Promise.resolve(org));
        getServicePlansStub = sandbox.stub(CloudControllerClient.prototype, 'getServicePlans');
        getServicePlansStub.withArgs(`unique_id:${smallPlanId}`).returns(Promise.resolve(smallServicePlan));
        getServicePlansStub.withArgs(`unique_id:${xsmallPlanId}`).returns(Promise.resolve(xsmallServicePlan));
        getServiceInstancesStub = sandbox.stub(CloudControllerClient.prototype, 'getServiceInstancesInOrgWithPlansGuids');
        getServiceInstancesStub.withArgs(orgId, [smallPlanGuid]).returns(Promise.resolve(serviceInstances));
        isOrgWhitelistedStub = sandbox.stub(QuotaManager.prototype, 'isOrgWhitelisted');
        isOrgWhitelistedStub.withArgs(orgId).returns(Promise.resolve(false));
      });
      afterEach(function () {
        getServicePlansStub.reset();
        getQuotaStub.reset();
        getOrganizationStub.reset();
        getServiceInstancesStub.reset();
      });
      after(function () {
        sandbox.restore();
      });

      it('returns quota does not exist when quota value is 3 and service instances created in the org is 3', () => {
        getQuotaStub.withArgs(orgId, serviceName, planName).returns(Promise.resolve(3));
        return quotaManager.checkQuota(orgId, smallPlanId)
          .then(value => {
            expect(value).to.eql(1);
          });
      });

      it('returns quota exists when for a plan skip_quota_check is enabled', () => {
        return quotaManager.checkQuota(orgId, rabbitmqVirtualHostPlanGuid)
          .then(value => {
            expect(value).to.eql(0);
          });
      });

      it('returns quota does not exist when quota value is 2 and service instances created in the org is 3', () => {
        getQuotaStub.withArgs(orgId, serviceName, planName).returns(Promise.resolve(2));
        return quotaManager.checkQuota(orgId, smallPlanId)
          .then(value => {
            expect(value).to.eql(1);
          });
      });

      it('returns quota exists when quota value is 4 and service instances created in the org is 3', () => {
        getQuotaStub.withArgs(orgId, serviceName, planName).returns(Promise.resolve(4));
        return quotaManager.checkQuota(orgId, smallPlanId)
          .then(value => {
            expect(value).to.eql(0);
          });
      });

      it('returns quota valid when quota value returned is -1 (i.e. org is whitelisted) and service instances created in the org is 3', () => {
        getQuotaStub.withArgs(orgId, serviceName, planName).returns(Promise.resolve(-1));
        return quotaManager.checkQuota(orgId, smallPlanId)
          .then(value => {
            expect(value).to.eql(0);
          });
      });

      it('returns quota invalid when quota value returned is 0 (i.e. not entitled) for the given org, service, plan', () => {
        getQuotaStub.withArgs(orgId, serviceName, planName).returns(Promise.resolve(0));
        return quotaManager.checkQuota(orgId, smallPlanId)
          .then(value => {
            expect(value).to.eql(2);
          });
      });

      it('returns quota valid when org is whitelisted', () => {
        isOrgWhitelistedStub.withArgs(orgId).returns(Promise.resolve(true));
        return quotaManager.checkQuota(orgId, smallPlanId)
          .then(value => {
            expect(value).to.eql(0);
          });
      });

    });

    describe('isOrgWhitelisted', () => {
      let sandbox, getOrganizationStub;
      let orgId = '63125bbc-81fe-46c3-9437-e5a8a6594774';
      let org = {
        'metadata': {
          'guid': '63125bbc-81fe-46c3-9437-e5a8a6594774'
        },
        'entity': {
          'name': 'dev'
        }
      };
      before(function () {
        sandbox = sinon.sandbox.create();
        getOrganizationStub = sandbox.stub(CloudControllerClient.prototype, 'getOrganization');
        getOrganizationStub.withArgs(orgId).returns(Promise.resolve(org));
      });
      afterEach(function () {
        getOrganizationStub.reset();
      });
      after(function () {
        sandbox.restore();
      });

      it('returns that the org is not whitelisted', () => {
        const QuotaManager = proxyquire('../lib/quota/QuotaManager', {
          '../config': {
            quota: {
              enabled: true,
              whitelist: ['SAP_UAA', 'SAP_provisioning']
            }
          }
        });

        const quotaManager = new QuotaManager();
        return quotaManager.isOrgWhitelisted(orgId)
          .then(value => {
            expect(value).to.eql(false);
          });
      });

      it('returns that the org is whitelisted', () => {
        const QuotaManager = proxyquire('../lib/quota/QuotaManager', {
          '../config': {
            quota: {
              enabled: true,
              whitelist: ['SAP_UAA', 'SAP_provisioning', 'dev']
            }
          }
        });

        const quotaManager = new QuotaManager();
        return quotaManager.isOrgWhitelisted(orgId)
          .then(value => {
            expect(value).to.eql(true);
          });
      });

    });

    describe('getAllPlanIdsWithSameSKU', () => {
      const v1smallPlanName = 'v1.0-small';
      const v1smallPlanId = 'bc158c9a-7934-401e-94ab-057082a5073e';
      const v1largePlanName = 'v1.0-large';
      const v1largePlanId = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
      const v2smallPlanName = 'v2.0-small';
      const v2smallPlanId = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const serviceName = 'blueprint';

      it('returns only v1.0-small plan id when v1.0-small plan name is passed, xsmall is excluded', () => {
        return quotaManager.getAllPlanIdsWithSameSKU(v1smallPlanName, serviceName, catalog)
          .then(value => {
            expect(value).to.eql([v1smallPlanId]);
          });
      });

      it('returns only v1.0-large plan id when v1.0-large plan name is passed, dev-large is excluded', () => {
        return quotaManager.getAllPlanIdsWithSameSKU(v1largePlanName, serviceName, catalog)
          .then(value => {
            expect(value).to.eql([v1largePlanId]);
          });
      });

      it('returns v1.0-small and v2.0-small plan id when v1.0-small plan name is passed, xsmall is excluded', () => {
        const v2smallPlan = _.clone(_.find(catalog.plans, ['name', v1smallPlanName]));
        v2smallPlan.name = v2smallPlanName;
        v2smallPlan.id = v2smallPlanId;

        const extendedCatalog = _.cloneDeep(catalog);
        const bpService = _.find(extendedCatalog.services, ['name', serviceName]);
        bpService.plans.push(v2smallPlan);

        return quotaManager.getAllPlanIdsWithSameSKU(v1smallPlanName, serviceName, extendedCatalog)
          .then(value => {
            expect(value).to.eql([v1smallPlanId, v2smallPlanId]);
          });
      });

    });

  });
});