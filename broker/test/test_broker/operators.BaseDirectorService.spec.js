'use strict';

// const _ = require('lodash');
const BaseDirectorService = require('../../applications/operators/src/BaseDirectorService');
// const CONST = require('../../common/constants');

describe('operators', function () {
  describe('BaseDirectorService', function () {
    describe('parseDeploymentName', function () {
      it('should parse the deployment name', function () {
        const guid = 'f7a9cc40-b5ca-4a72-a093-9dbce9778e9b';
        const parsed = BaseDirectorService.parseDeploymentName(`service-fabrik-1234-${guid}`);
        expect(parsed).to.eql([
          'service-fabrik',
          1234,
          guid
        ]);
      });
      it('should parse the deployment name with subnet', function () {
        const guid = 'f7a9cc40-b5ca-4a72-a093-9dbce9778e9b';
        const parsed = BaseDirectorService.parseDeploymentName(`service-fabrik_fakeSubnet-1234-${guid}`, 'fakeSubnet');
        expect(parsed).to.eql([
          'service-fabrik_fakeSubnet',
          1234,
          guid
        ]);
      });
    });
    // describe('getTenantGuid', function () {
    //   const bds = new BaseDirectorService('fake-plan');
    //   const context = {
    //     space_guid: 'fake-space-guid',
    //     namespace: 'fake-namespace'
    //   };
    //   it('should return space_guid from context when platform is cf', function () {
    //     expect(bds.getTenantGuid(_
    //       .assign({
    //         'platform': CONST.PLATFORM.CF
    //       }, context)
    //     )).to.eql('fake-space-guid');
    //   });
    //   it('should return namespace from context when platform is K8S', function () {
    //     expect(bds.getTenantGuid(_
    //       .assign({
    //         'platform': CONST.PLATFORM.K8S
    //       }, context)
    //     )).to.eql('fake-namespace');
    //   });
    // });
  });
});
