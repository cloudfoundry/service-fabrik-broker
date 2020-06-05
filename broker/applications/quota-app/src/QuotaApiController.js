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
      const quotaManager = commonFunctions.isBrokerBoshDeployment() ?
        quota.getQuotaManagerInstance(CONST.PLATFORM.CF) : 
        quota.getQuotaManagerInstance(CONST.PLATFORM.K8S);
      const orgOrSubaccountId = req.params.accountId;
      const planId = _.get(req, 'query.planId');
      const previousPlanId = _.get(req, 'query.previousPlanId');
      const reqMethod = _.get(req, 'query.reqMethod');
      const isSubaccount = _.get(req, 'query.isSubaccountFlag');
      const isSubaccountFlag = (isSubaccount === 'true');
      logger.info(`[Quota APP] accountID: ${orgOrSubaccountId}, planId: ${planId}, previousPlanId: ${previousPlanId}, reqMethod: ${reqMethod}, isSubaccountFlag: ${isSubaccountFlag}`);
      const validStatus = await quotaManager.checkQuota(orgOrSubaccountId, planId, previousPlanId, reqMethod, isSubaccountFlag);
      await res.status(CONST.HTTP_STATUS_CODE.OK).send({ quotaValidStatus: validStatus });
    } catch (err) {
      logger.error(`[Quota APP] Quota check could not be completed due to following error: ${err}`);
      await res.status(CONST.HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).send({ error: err });
    }
  }  
}

module.exports = QuotaApiController;
