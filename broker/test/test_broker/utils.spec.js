'use strict';

const DirectorService = require('@sf/provisioner-services').DirectorService;
const {
  CONST,
  commonFunctions
} = require('@sf/common-utils');
const { getPlatformManager } = require('@sf/platforms');
const {
  apiServerClient,
  utils
} = require('@sf/eventmesh');

describe('utils', function () {
  describe('#deploymentNameRegExp', function () {
    let test_subnet = 'test-subnet';
    let deployment_name = `${DirectorService.prefix}_${test_subnet}-1234-5432abcd-1098-abcd-7654-3210abcd9876`;

    it('should match network index', function () {
      expect(commonFunctions.deploymentNameRegExp(test_subnet).exec(deployment_name)[2]).to.eql('1234');
    });
    it('should match guid', function () {
      expect(commonFunctions.deploymentNameRegExp(test_subnet).exec(deployment_name)[3]).to.eql('5432abcd-1098-abcd-7654-3210abcd9876');
    });

    it('should match name and subnet', function () {
      expect(commonFunctions.deploymentNameRegExp(test_subnet).exec(deployment_name)[1]).to.eql('service-fabrik_test-subnet');
      // removesubnet 
      deployment_name = `${DirectorService.prefix}-1234-5432abcd-1098-abcd-7654-3210abcd9876`;
      expect(commonFunctions.deploymentNameRegExp().exec(deployment_name)[1]).to.eql('service-fabrik');
      expect(commonFunctions.deploymentNameRegExp('').exec(deployment_name)[1]).to.eql('service-fabrik');
    });
  });

  describe('#taskIdRegExp', function () {
    it('should match name and taskId', function () {
      let prefixedTaskId = `${DirectorService.prefix}-1234-5432abcd-1098-abcd-7654-3210abcd9876_12345`;
      expect(commonFunctions.taskIdRegExp().exec(prefixedTaskId)[1]).to.eql(`${DirectorService.prefix}-1234-5432abcd-1098-abcd-7654-3210abcd9876`);
      expect(commonFunctions.taskIdRegExp().exec(prefixedTaskId)[2]).to.eql('12345');
    });
  });

  describe('#Random', function () {
    let randomIntStub;
    before(function () {
      randomIntStub = sinon.stub(commonFunctions, 'getRandomInt').callsFake(() => 1);
    });
    after(function () {
      randomIntStub.restore();
    });
    it('should return a random cron expression for every x hours for the day', function () {
      const AssertionError = require('assert').AssertionError;
      expect(commonFunctions.getRandomCronForEveryDayAtXHoursInterval.bind(commonFunctions, 29)).to.throw(AssertionError);
      // bind returns a ref to function which is executed and checked for if it threw exception.
      expect(commonFunctions.getRandomCronForEveryDayAtXHoursInterval(8)).to.eql('1 1,9,17 * * *');
      expect(commonFunctions.getRandomCronForEveryDayAtXHoursInterval(7)).to.eql('1 1,8,15,22 * * *');
      expect(commonFunctions.getRandomCronForEveryDayAtXHoursInterval(3)).to.eql('1 1,4,7,10,13,16,19,22 * * *');
    });
  });

  describe('#isServiceFabrikOperation', function () {
    /* jshint expr:true */
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id_update = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
    let queryParams = {
      service_id: service_id,
      plan_id: plan_id_update,
      previous_values: {
        service_id: service_id
      }
    };
    it('not a service-fabrik-operation, should return false', function () {
      queryParams.parameters = {
        foo: 'bar'
      };
      expect(commonFunctions.isServiceFabrikOperation(queryParams)).to.be.false;
    });
    it('service-fabrik-operation, should return true', function () {
      queryParams.parameters = {
        'service-fabrik-operation': 'token'
      };
      expect(commonFunctions.isServiceFabrikOperation(queryParams)).to.be.true;
    });
  });

  describe('#getRandomCronForOnceEveryXDaysWeekly', function () {
    const AssertionError = require('assert').AssertionError;
    it('should create a weekly random schedule - no options given', function () {
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* [0-6]', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly()
        )).to.be.eql(true);
    });
    it('should create a weekly schedule in the given range', function () {
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* [3-6]', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'start_after_weekday': 3
          })
        )).to.be.eql(true);
    });
    it('should create a weekly schedule when interval given', function () {
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* 0,1,2,3,4,5,6', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'day_interval': 1
          })
        )).to.be.eql(true);
    });
    it('should create a weekly schedule when interval and bounds are given', function () {
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* 3,4', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'start_after_weekday': 3,
            'start_before_weekday': 5,
            'day_interval': 1
          })
        )).to.be.eql(true);
    });
    it('should support throw error if bounds are same', function () {
      expect(commonFunctions
        .getRandomCronForOnceEveryXDaysWeekly
        .bind(commonFunctions, {
          'start_after_weekday': 0,
          'start_before_weekday': 0,
          'day_interval': 1
        })
      ).to.throw(AssertionError);
    });
    it('should create weekly cron within bounds', function () {
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* 0,1,2', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'start_after_weekday': 0,
            'start_before_weekday': 3,
            'day_interval': 1
          })
        )).to.be.eql(true);
    });
    it('should create valid weekly cron when interval set to zero', function () {
      // interval 0
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* [0-6]', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'day_interval': 0
          })
        )
      ).to.be.eql(true);
    });

    it('should create weekly cron when interval greter than 4, start day given', function () {
      // interval > 6, start_after_weekday provided
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* [3-6]', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'start_after_weekday': 3,
            'day_interval': 7
          })
        )
      ).to.be.eql(true);
    });

    it('should create weekly cron when interval less than 4, start day given', function () {
      // interval > 6, start_after_weekday provided
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* 0,2,4,6', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'start_after_weekday': 0,
            'day_interval': 2
          })
        )
      ).to.be.eql(true);
    });

    it('should create weekly cron when interal greter than weekdays', function () {
      // interval > 6
      expect(RegExp('[0-9]+ [0-9]+ \\* \\* [0-6]', 'g')
        .test(commonFunctions
          .getRandomCronForOnceEveryXDaysWeekly({
            'day_interval': 7
          })
        )
      ).to.be.eql(true);

    });
  });

  describe('#getCronWithIntervalAndAfterXminute', function () {
    const AssertionError = require('assert').AssertionError;
    it('should support daily schedule', function () {
      expect(RegExp('[0-9]+ [0-9]+ \* \* \*').test(commonFunctions.getCronWithIntervalAndAfterXminute('daily'))).to.be.eql(true);
    });

    it('should support every \'24 hours\' schedule', function () {
      expect(RegExp('[0-9]+ [0-9]+ \* \* \*').test(commonFunctions.getCronWithIntervalAndAfterXminute('24 hours'))).to.be.eql(true);
    });

    it('should support every \'8 hours\' (divides 24) schedule', function () {
      expect(RegExp('[0-9]+ [0-9]+[\,]{1}[0-9]+[\,]{1}[0-9]+ \* \* \*').test(commonFunctions.getCronWithIntervalAndAfterXminute('8 hours'))).to.be.eql(true);
    });

    it('should support every \'9 hours\' (24 non divisible) schedule', function () {
      expect(RegExp('[0-9]+ [0-9\,]+ \* \* \*').test(commonFunctions.getCronWithIntervalAndAfterXminute('9 hours', 2))).to.be.eql(true);
    });

    it('should support every \'1 hours\' (24 non divisible) schedule', function () {
      expect(RegExp('[0-9]+ [0-9\,]+ \* \* \*').test(commonFunctions.getCronWithIntervalAndAfterXminute('1 hours'))).to.be.eql(true);
    });

    it('should not support invalid interval format', function () {
      expect(commonFunctions.getCronWithIntervalAndAfterXminute.bind(commonFunctions, 'random', 2)).to.throw(AssertionError);
    });

    it('should not support invalid schedule', function () {
      expect(commonFunctions.getCronWithIntervalAndAfterXminute.bind(commonFunctions, '35 hours')).to.throw(AssertionError);
    });
  });

  describe('#getBrokerAgentCredsFromManifest', function () {
    const manifest1 = {
      name: 'test-deployment-name',
      instance_groups: [{
        name: 'blueprint',
        jobs: [{
          name: 'blueprint',
          properties: {
            admin: {
              username: 'admin',
              password: 'admin'
            },
            mongodb: {
              service_agent: {
                username: 'admin',
                password: 'admin'
              }
            }
          }
        },
        {
          name: 'broker-agent',
          properties: {
            username: 'admin1',
            password: 'admin1',
            provider: {
              name: 'openstack'
            }
          }
        }
        ]
      }]
    };

    const manifest2 = {
      name: 'test-deployment-name',
      instance_groups: [{
        name: 'blueprint',
        jobs: [{
          name: 'blueprint',
          properties: {
            admin: {
              username: 'admin',
              password: 'admin'
            },
            mongodb: {
              service_agent: {
                username: 'admin',
                password: 'admin'
              }
            }
          }
        },
        {
          name: 'broker-agent',
          properties: {
            username: 'admin2',
            password: 'admin2',
            provider: {
              name: 'openstack'
            }
          }
        }
        ]
      },
      {
        name: 'blueprint2',
        jobs: [{
          name: 'blueprint',
          properties: {
            admin: {
              username: 'admin',
              password: 'admin'
            },
            mongodb: {
              service_agent: {
                username: 'admin',
                password: 'admin'
              }
            }
          }
        }]
      }
      ]
    };

    const manifest3 = {
      name: 'test-deployment-name',
      instance_groups: [{
        name: 'blueprint2',
        jobs: [{
          name: 'blueprint',
          properties: {
            admin: {
              username: 'admin',
              password: 'admin'
            },
            mongodb: {
              service_agent: {
                username: 'admin',
                password: 'admin'
              }
            }
          }
        }]
      },
      {
        name: 'blueprint',
        jobs: [{
          name: 'blueprint',
          properties: {
            admin: {
              username: 'admin',
              password: 'admin'
            },
            mongodb: {
              service_agent: {
                username: 'admin',
                password: 'admin'
              }
            }
          }
        },
        {
          name: 'test-broker-agent',
          properties: {
            username: 'admin3',
            password: 'admin3',
            provider: {
              name: 'openstack'
            }
          }
        }
        ]
      }
      ]
    };

    const manifest4 = {
      name: 'test-deployment-name',
      instance_groups: [{
        name: 'blueprint',
        jobs: [{
          name: 'blueprint',
          properties: {
            admin: {
              username: 'admin',
              password: 'admin'
            },
            mongodb: {
              service_agent: {
                username: 'admin',
                password: 'admin'
              }
            }
          }
        },
        {
          name: 'broker-agent-my',
          properties: {
            username: 'admin4',
            password: 'admin4',
            provider: {
              name: 'openstack'
            }
          }
        }
        ]
      }]
    };
    it('should return correct agent creds for all possible kind of manifest formats', function () {
      expect(commonFunctions.getBrokerAgentCredsFromManifest(manifest1)).to.eql({
        username: 'admin1',
        password: 'admin1'
      });
      expect(commonFunctions.getBrokerAgentCredsFromManifest(manifest2)).to.eql({
        username: 'admin2',
        password: 'admin2'
      });
      expect(commonFunctions.getBrokerAgentCredsFromManifest(manifest3)).to.eql({
        username: 'admin3',
        password: 'admin3'
      });
      expect(commonFunctions.getBrokerAgentCredsFromManifest(manifest4)).to.eql({
        username: 'admin4',
        password: 'admin4'
      });
    });
  });
  describe('#getPlatformManager', function () {
    it('should return cf platform manager if platform is cf', function () {
      const platformManager = getPlatformManager({
        platform: 'cf'
      });
      expect(platformManager.platform).to.eql('cf');
    });
    it('should return k8s platform manager if platform is k8s', function () {
      const platformManager = getPlatformManager({
        platform: 'k8s'
      });
      expect(platformManager.platform).to.eql('k8s');
    });
    it('should return cf platform manager if platform is sapcp and origin is cf', function () {
      const platformManager = getPlatformManager({
        platform: 'sapcp',
        origin: 'cf'
      });
      expect(platformManager.platform).to.eql('cf');
    });
  });

  describe('#getPlatformFromContext', function () {
    it('should handle context originating from CF/k8s platform', function () {
      let context = {
        platform: 'cloudfoundry',
        organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
        space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
      };

      expect(commonFunctions.getPlatformFromContext(context)).to.eql('cloudfoundry');
    });

    it('should handle the context originating from SM platform', function () {
      let context = {
        platform: 'sapcp',
        origin: 'cloudfoundry',
        organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
        space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
      };

      expect(commonFunctions.getPlatformFromContext(context)).to.eql('cloudfoundry');
    });
  });
  describe('#pushServicePlanToApiServer', function () {
    it('Push Service and Plans on apiserver', function () {
      mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, {}, 4);
      mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS, {}, 14);
      return utils.pushServicePlanToApiServer()
        .then(res => {
          expect(res.length).to.eql(4);
          mocks.verify();
        });
    });
  });

  describe('#registerSFEventsCrd', () => {
    it('Patch already registered SFEvents CRD successfully', () => {
      const meteringCrdJson = apiServerClient.getCrdJson(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE, CONST.APISERVER.RESOURCE_TYPES.SFEVENT);
      mocks.apiServerEventMesh.nockCreateCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, meteringCrdJson.metadata.name, {}, meteringCrdJson, 409);
      mocks.apiServerEventMesh.nockPatchCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, meteringCrdJson.metadata.name, {}, meteringCrdJson);
     return utils.registerSFEventsCrd()
        .then(() => {
          mocks.verify();
        });
    });
  });

  describe('#waitWhileCRDsAreRegistered', () => {
    let sandbox, delayStub;
    before(function () {
      sandbox = sinon.createSandbox();
      delayStub = sandbox.stub(Promise, 'delay').callsFake(() => Promise.resolve(true));
    });

    after(function () {
      delayStub.restore();
    });
    it('waiting successfully till the sfservices ', () => {
       mocks.apiServerEventMesh.nockGetCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES + '.' + CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, {}, 1, 404);
       mocks.apiServerEventMesh.nockGetCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES + '.' + CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, {}, 1, 200);
       mocks.apiServerEventMesh.nockGetCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS + '.' + CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, {}, 1, 404);
       mocks.apiServerEventMesh.nockGetCrd(CONST.APISERVER.CRD_RESOURCE_GROUP, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS + '.' + CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, {}, 1, 200);
       return utils.waitWhileCRDsAreRegistered()
        .then(() => {
          mocks.verify();
        });
    });
  });

  describe('#getAllServices', () => {
    it('Gets list of services from apiserver', () => {
      const expectedResponse = {
        items: [{
          spec: {
            id: 'service1',
            name: 's1'
          }
        }]
      };
      mocks.apiServerEventMesh.nockGetResourcesAcrossAllNamespaces(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, expectedResponse, {});
      return utils.getAllServices()
        .then(res => {
          expect(res).to.eql([expectedResponse.items[0].spec]);
          mocks.verify();
        });
    });
    it('Throws error on getting list of services from apiserver', () => {
      mocks.apiServerEventMesh.nockGetResourcesAcrossAllNamespaces(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES, {}, {}, 1, 500);
      return utils.getAllServices()
        .catch(err => {
          expect(err.status).to.eql(500);
          mocks.verify();
        });
    });
  });

  describe('#getAllPlansForService', () => {
    it('Gets list of plans from apiserver', () => {
      const expectedResponse = {
        items: [{
          spec: {
            id: 'plan1',
            name: 'p1'
          }
        }]
      };
      mocks.apiServerEventMesh.nockGetResourcesAcrossAllNamespaces(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS, expectedResponse, {
        labelSelector: 'serviceId=service1'
      });
      return utils.getAllPlansForService('service1')
        .then(res => {
          expect(res).to.eql([expectedResponse.items[0].spec]);
          mocks.verify();
        });
    });
    it('Throws error on getting list of plans from apiserver', () => {
      mocks.apiServerEventMesh.nockGetResourcesAcrossAllNamespaces(CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR, CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS, {}, {
        labelSelector: 'serviceId=service1'
      }, 1, 500);
      return utils.getAllPlansForService('service1')
        .catch(err => {
          expect(err.status).to.eql(500);
          mocks.verify();
        });
    });
  });

  describe('#unifyDiffResult', () => {
    let sampleDiff = { '0': [ 'stemcells:', 'added' ],
      '1': [ '- alias: ubuntu-xenial', 'added' ],
      '2': [ '  name: bosh-aws-xen-hvm-ubuntu-xenial-go_agent', 'added' ],
      '3': [ '  version: \'170.24\'', 'added' ],
      '4': [ '', null ],
      '5': [ 'releases:', null ],
      '6': [ '- name: blueprint', 'added' ],
      '7': [ '  version: 1.23.0', 'added' ],
      '8': [ '- name: service-fabrik', 'added' ],
      '9': [ '  version: 3.110.0', 'added' ],
      '10': [ '', null ],
      '11': [ 'update:', 'added' ],
      '12': [ '  canaries: 0', 'added' ],
      '13': [ '  max_in_flight: 50', 'added' ],
      '14': [ '  canary_watch_time: 1000-100000', 'added' ],
      '15': [ '  update_watch_time: 1000-100000', 'added' ],
      '16': [ '  serial: false', 'added' ],
      '17': [ '', null ],
      '18': [ 'addons:', 'added' ],
      '19': [ '- name: iptables-manager', 'added' ],
      '20': [ '  jobs:', 'added' ],
      '21': [ '  - name: iptables-manager', 'added' ],
      '22': [ '    release: service-fabrik', 'added' ],
      '23': [ '    properties:', 'added' ],
      '24': 
     [ '      allow_ips_list: 10.11.13.80',
       'added' ],
      '25': 
     [ '      block_ips_list: 10.11.0.0/18,10.11.64.0/18,10.11.128.0/18',
       'added' ],
      '26': [ '', null ],
      '27': 
     [ 'name: service-fabrik-0394-34293c64-1c99-4611-9146-fcac7756101d',
       'added' ],
      '28': [ '', null ],
      '29': [ 'tags:', 'added' ],
      '30': 
     [ '  organization_guid: 57caa1ea-b47c-408c-8e58-1610b20c9faf',
       'added' ],
      '31': [ '  platform: cloudfoundry', 'added' ],
      '32': 
     [ '  space_guid: f6be1038-fbba-4ee5-89b1-f801d0eb144d',
       'added' ],
      '33': [ '', null ] };

    it('should ignore tags in diff when ignoreTags flag is true', () => {
      let dummyOutdatedResult = {
        diff: sampleDiff
      };
      let expectedOp = [
        '+stemcells:',
        '+- alias: ubuntu-xenial',
        '+  name: bosh-aws-xen-hvm-ubuntu-xenial-go_agent',
        "+  version: '170.24'",
        ' ',
        ' releases:',
        '+- name: blueprint',
        '+  version: 1.23.0',
        '+- name: service-fabrik',
        '+  version: 3.110.0',
        ' ',
        '+update:',
        '+  canaries: 0',
        '+  max_in_flight: 50',
        '+  canary_watch_time: 1000-100000',
        '+  update_watch_time: 1000-100000',
        '+  serial: false',
        ' ',
        '+addons:',
        '+- name: iptables-manager',
        '+  jobs:',
        '+  - name: iptables-manager',
        '+    release: service-fabrik',
        '+    properties:',
        '+      allow_ips_list: 10.11.13.80',
        '+      block_ips_list: 10.11.0.0/18,10.11.64.0/18,10.11.128.0/18',
        ' ',
        '+name: service-fabrik-0394-34293c64-1c99-4611-9146-fcac7756101d',
        ' '
      ];
      
      let actualOp = commonFunctions.unifyDiffResult(dummyOutdatedResult, true);
      expect(actualOp).to.deep.equal(expectedOp);
    });

    it('should not ignore tags in diff by default', () => {
      let dummyOutdatedResult = {
        diff: sampleDiff
      };
      let expectedOp = [ '+stemcells:',
        '+- alias: ubuntu-xenial',
        '+  name: bosh-aws-xen-hvm-ubuntu-xenial-go_agent',
        "+  version: '170.24'",
        ' ',
        ' releases:',
        '+- name: blueprint',
        '+  version: 1.23.0',
        '+- name: service-fabrik',
        '+  version: 3.110.0',
        ' ',
        '+update:',
        '+  canaries: 0',
        '+  max_in_flight: 50',
        '+  canary_watch_time: 1000-100000',
        '+  update_watch_time: 1000-100000',
        '+  serial: false',
        ' ',
        '+addons:',
        '+- name: iptables-manager',
        '+  jobs:',
        '+  - name: iptables-manager',
        '+    release: service-fabrik',
        '+    properties:',
        '+      allow_ips_list: 10.11.13.80',
        '+      block_ips_list: 10.11.0.0/18,10.11.64.0/18,10.11.128.0/18',
        ' ',
        '+name: service-fabrik-0394-34293c64-1c99-4611-9146-fcac7756101d',
        ' ',
        '+tags:',
        '+  organization_guid: 57caa1ea-b47c-408c-8e58-1610b20c9faf',
        '+  platform: cloudfoundry',
        '+  space_guid: f6be1038-fbba-4ee5-89b1-f801d0eb144d',
        ' '];
      let actualOp = commonFunctions.unifyDiffResult(dummyOutdatedResult);
      expect(actualOp).to.deep.equal(expectedOp);
    });
  });
});
