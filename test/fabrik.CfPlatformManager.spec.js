'use strict';

const Promise = require('bluebird');
const errors = require('../lib/errors');
const CfPlatformManager = require('../lib/fabrik/CfPlatformManager');
const BasePlatformManager = require('../lib/fabrik/BasePlatformManager');
const NotImplemented = errors.NotImplemented;


describe('fabrik', function () {
  describe('PlatformManager', function () {

    describe('#CfPlatformManager', function () {
      let context = {
        platform: 'cloudfoundry',
        space_guid: '1a6e7c34-d97c-4fc0-95e6-7a3bc8030be1',
        organization_guid: '2a6e7c34-d97c-4fc0-95e6-7a3bc8030be2'
      };
      let platformManager = BasePlatformManager.getInstance('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9', context);
      it('should throw NotImplemented error from  preInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.space_guid).to.eql(context.space_guid);
        expect(platformManager.context).to.eql(context);
        expect(platformManager).to.be.instanceof(CfPlatformManager);
        return Promise.try(() => platformManager.preInstanceProvisionOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });
    });

    describe('#BasePlatformManager', function () {
      let context = {
        platform: 'kubernetes',
        namespace: 'default'
      };
      let platformManager = BasePlatformManager.getInstance('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9', context);
      it('should throw NotImplemented error from  preInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.space_guid).to.eql(context.space_guid);
        expect(platformManager.context).to.eql(context);
        expect(platformManager).to.be.instanceof(BasePlatformManager);
        return Promise.resolve();
      });
    });

  });
});