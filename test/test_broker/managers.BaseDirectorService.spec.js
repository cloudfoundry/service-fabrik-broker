'use strict';

const BaseDirectorService = require('../../managers/BaseDirectorService');

describe('managers', function () {
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
  });
});