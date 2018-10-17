'use strict';

const workflowMapper = require('../../common/utils/WorkFlowMapper');
const CONST = require('../../common/constants');

describe('utils', function () {
  describe('WorkflowMapper', function () {
    it('Should return back blueprint workflow', () => {
      const workflowName = workflowMapper.getWorkFlow({
        parameters: {
          multi_az: true
        }
      });
      expect(workflowName).to.equal(CONST.WORKFLOW.TYPE.UPGRADE_MULTI_AZ);
    });
    it('Should return back blueprint workflow', () => {
      const workflowName = workflowMapper.getWorkFlow({
        parameters: {
          multi_az_bp: true
        }
      });
      expect(workflowName).to.equal(CONST.WORKFLOW.TYPE.BLUEPRINT_WORKFLOW);
    });
  });
});