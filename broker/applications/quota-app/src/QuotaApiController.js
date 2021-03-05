'use strict';

const _ = require('lodash');

const quota = require('@sf/quota');
const {
  FabrikBaseController
} = require('@sf/common-controllers');
const {
  CONST,
  commonFunctions
} = require('@sf/common-utils');
const logger = require('@sf/logger');

class QuotaApiController extends FabrikBaseController {
  constructor() {
    super();
  }
  async getQuotaValidStatus(req, res) {
    /*
      case 1 : BOSH + CF => org API and CF
      case 2: BOSH + SM => org API and CF
      case 3 : K8S + CF => org API and apiserver
      case 4 : K8S + SM (CF + K8S) => subaccount based API and apiserver
    */
    try {
      const region = _.get(req, 'query.region');
      const quotaManager = commonFunctions.isBrokerBoshDeployment() ?
        quota.getQuotaManagerInstance(CONST.PLATFORM.CF, region) :
        quota.getQuotaManagerInstance(CONST.PLATFORM.K8S, region);
      const subaccountId = req.params.accountId;
      const planId = _.get(req, 'query.planId');
      const previousPlanId = _.get(req, 'query.previousPlanId');
      const orgId = _.get(req, 'query.orgId');
      const reqMethod = _.get(req, 'query.reqMethod');
      const useAPIServerForConsumedQuotaCheck = _.get(req, 'query.useAPIServerForConsumedQuotaCheck');
      const useAPIServerForConsumedQuotaCheckFlag = (useAPIServerForConsumedQuotaCheck === 'true');
      logger.info(`[Quota APP] subaccountId: ${subaccountId}, orgId: ${orgId}, planId: ${planId}, previousPlanId: ${previousPlanId}, reqMethod: ${reqMethod}, useAPIServerForConsumedQuotaCheckFlag: ${useAPIServerForConsumedQuotaCheckFlag}`);
      const validStatus = await quotaManager.checkQuota(subaccountId, orgId, planId, previousPlanId, reqMethod, useAPIServerForConsumedQuotaCheckFlag, region);
      await res.status(CONST.HTTP_STATUS_CODE.OK).send({ quotaValidStatus: validStatus });
    } catch (err) {
      logger.error(`[Quota APP] Quota check could not be completed due to following error: ${err}`);
      await res.status(CONST.HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).send({ error: err });
    }
  }  
}

module.exports = QuotaApiController;
