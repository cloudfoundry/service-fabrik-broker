'use strict';

const lib = require('../lib');
const DirectorManager = lib.fabrik.DirectorManager;
const utils = lib.utils;

describe('utils', function () {
  describe('#deploymentNameRegExp', function () {
    let test_subnet = 'test-subnet';
    let deployment_name = `${DirectorManager.prefix}_${test_subnet}-1234-5432abcd-1098-abcd-7654-3210abcd9876`;

    it('should match network index', function () {
      expect(utils.deploymentNameRegExp(test_subnet).exec(deployment_name)[2]).to.eql('1234');
    });
    it('should match guid', function () {
      expect(utils.deploymentNameRegExp(test_subnet).exec(deployment_name)[3]).to.eql('5432abcd-1098-abcd-7654-3210abcd9876');
    });

    it('should match name and subnet', function () {
      expect(utils.deploymentNameRegExp(test_subnet).exec(deployment_name)[1]).to.eql('service-fabrik_test-subnet');
      // removesubnet 
      deployment_name = `${DirectorManager.prefix}-1234-5432abcd-1098-abcd-7654-3210abcd9876`;
      expect(utils.deploymentNameRegExp().exec(deployment_name)[1]).to.eql('service-fabrik');
      expect(utils.deploymentNameRegExp('').exec(deployment_name)[1]).to.eql('service-fabrik');
    });
  });

  describe('#taskIdRegExp', function () {
    it('should match name and taskId', function () {
      let prefixedTaskId = `${DirectorManager.prefix}-1234-5432abcd-1098-abcd-7654-3210abcd9876_12345`;
      expect(utils.taskIdRegExp().exec(prefixedTaskId)[1]).to.eql(`${DirectorManager.prefix}-1234-5432abcd-1098-abcd-7654-3210abcd9876`);
      expect(utils.taskIdRegExp().exec(prefixedTaskId)[2]).to.eql('12345');
    });
  });

  describe('#Random', function () {
    let randomIntStub;
    before(function () {
      randomIntStub = sinon.stub(utils, 'getRandomInt', () => 1);
    });
    after(function () {
      randomIntStub.restore();
    });
    it('should return a random cron expression for once every 15 days', function () {
      const AssertionError = require('assert').AssertionError;
      expect(utils.getRandomCronForOnceEveryXDays.bind(utils, 29)).to.throw(AssertionError);
      //bind returns a ref to function which is executed and checked for if it threw exception.
      expect(utils.getRandomCronForOnceEveryXDays(2)).to.eql('1 1 1,3,5,7,9,11,13,15,17,19,21,23,25,27,29 * *');
      expect(utils.getRandomCronForOnceEveryXDays(7)).to.eql('1 1 1,8,15,22 * *');
      expect(utils.getRandomCronForOnceEveryXDays(15)).to.eql('1 1 1,16 * *');
    });
    it('should return a random cron expression for every x hours for the day', function () {
      const AssertionError = require('assert').AssertionError;
      expect(utils.getRandomCronForEveryDayAtXHoursInterval.bind(utils, 29)).to.throw(AssertionError);
      //bind returns a ref to function which is executed and checked for if it threw exception.
      expect(utils.getRandomCronForEveryDayAtXHoursInterval(8)).to.eql('1 1,9,17 * * *');
      expect(utils.getRandomCronForEveryDayAtXHoursInterval(7)).to.eql('1 1,8,15,22 * * *');
      expect(utils.getRandomCronForEveryDayAtXHoursInterval(3)).to.eql('1 1,4,7,10,13,16,19,22 * * *');
    });
  });

  describe('#isServiceFabrikOperation', function () {
    /* jshint expr:true */
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id_update = 'd616b00a-5949-4b1c-bc73-0d3c59f3954a';
    var queryParams = {
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
      expect(utils.isServiceFabrikOperation(queryParams)).to.be.false;
    });
    it('service-fabrik-operation, should return true', function () {
      queryParams.parameters = {
        'service-fabrik-operation': 'token'
      };
      expect(utils.isServiceFabrikOperation(queryParams)).to.be.true;
    });
  });
});