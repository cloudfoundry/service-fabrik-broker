'use strict';

const serviceFlowMapper = require('../../common/utils/ServiceFlowMapper');
const CONST = require('../../common/constants');

describe('utils', function () {
  describe('ServiceFlowMapper', function () {
    it('Should return back upgrade to multi-az Service Flow', () => {
      let serviceFlowName = serviceFlowMapper.getServiceFlow({
        parameters: {
          multi_az: true
        }
      });
      expect(serviceFlowName).to.equal(CONST.SERVICE_FLOW.TYPE.UPGRADE_MULTI_AZ);
      serviceFlowName = serviceFlowMapper.getServiceFlow({
        parameters: {
          multi_az: 'true'
        }
      });
      expect(serviceFlowName).to.equal(CONST.SERVICE_FLOW.TYPE.UPGRADE_MULTI_AZ);
    });
    it('Should return back downgrade to single-az Service Flow', () => {
      const serviceFlowName = serviceFlowMapper.getServiceFlow({
        parameters: {
          multi_az: false
        }
      });
      expect(serviceFlowName).to.equal(CONST.SERVICE_FLOW.TYPE.DOWNGRADE_TO_SINGLE_AZ);
    });
    it('Should return back blueprint ServiceFlow', () => {
      const serviceFlowName = serviceFlowMapper.getServiceFlow({
        parameters: {
          multi_az_bp: true
        }
      });
      expect(serviceFlowName).to.equal(CONST.SERVICE_FLOW.TYPE.BLUEPRINT_SERVICEFLOW);
    });
  });
});