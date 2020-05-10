'use strict';

const { catalog } = require('@sf/models');
const DirectorService = require('../../applications/operators/bosh-operator/DirectorService');
const BoshDirectorClient = require('../../data-access-layer/bosh').BoshDirectorClient;

const proxyquire = require('proxyquire');
let networks = [{
  name: 'default',
  type: 'manual',
  subnets: [{
    range: '10.244.10.0/24',
    az: 'zone1',
    cloud_properties: {
      name: 'random'
    }
  }]
}, {
  name: 'public',
  type: 'manual',
  subnets: [{
    range: '10.11.192.0/20',
    az: 'zone1',
    cloud_properties: {
      name: 'random'
    }
  }]
}];

let mock_config;

const NetworkSegmentIndex = proxyquire('../../data-access-layer/bosh/src/NetworkSegmentIndex', {
  lodash: {
    sample: function (collection) {
      return collection[2];
    }
  }
});


let getInfrastructureStub, setDefaultConfig, updateStub;
describe('bosh', () => {
  before(function () {
    getInfrastructureStub = sinon.stub(BoshDirectorClient, 'getInfrastructure');
    setDefaultConfig = function () {
      getInfrastructureStub.withArgs().returns({
        segmentation: {
          capacity: 1235,
          offset: 1,
          size: 8
        },
        networks: networks
      });
    };
    updateStub = function (capacity) {
      mock_config = {
        infrastructure: {
          segmentation: {
            capacity: capacity
          },
          networks: networks
        }
      };
      getInfrastructureStub.withArgs().returns(mock_config.infrastructure);
    };
  });
  after(function () {
    getInfrastructureStub.restore();
  });

  describe('NetworkSegmentIndex', () => {
    describe('#adjust', () => {
      it('returns a left-padded string', () => {
        setDefaultConfig();
        expect(NetworkSegmentIndex.adjust('123')).to.eql('0123');
        expect(NetworkSegmentIndex.adjust('123', 6)).to.eql('000123');
      });
    });

    describe('#calculateCapacity', () => {
      it('returns 1235', () => {
        setDefaultConfig();
        expect(NetworkSegmentIndex.capacity('default')).to.eql(1235);
      });

      it('returns 126', () => {
        updateStub(-1);
        expect(NetworkSegmentIndex.capacity(undefined)).to.eql(126);
      });

      it('returns 2046', () => {
        updateStub(-1);
        expect(NetworkSegmentIndex.capacity('public')).to.eql(2046);
      });

      it('returns 1', () => {
        updateStub(1);
        expect(NetworkSegmentIndex.capacity(undefined)).to.eql(1);
      });
    });

    let directorService = null;
    before(function () {
      directorService = new DirectorService(catalog.getPlan('bc158c9a-7934-401e-94ab-057082a5073f'));
    });
    describe('#getUsedIndices', () => {

      it('returns an array that contains two four-digit integers', () => {
        let expectedUsedIndices = [1234, 9876];
        let usedIndices = NetworkSegmentIndex.getUsedIndices([{
          name: `${DirectorService.prefix}-${expectedUsedIndices[0]}-5432abcd-1098-abcd-7654-3210abcd9876`
        },
        `${DirectorService.prefix}-${expectedUsedIndices[1]}-5678abcd-9012-abcd-3456-7890abcd1234`,
        'no-match'
        ], directorService.service.subnet);
        expect(usedIndices).to.eql(expectedUsedIndices);
      });

      it('return indices used by public deployments alone', () => {
        let indices = [1234, 9876, 3456, 5678];
        let usedIndices = NetworkSegmentIndex.getUsedIndices([{
          name: `${DirectorService.prefix}-${indices[0]}-5432abcd-1098-abcd-7654-3210abcd9876`
        },
        `${DirectorService.prefix}-${indices[1]}-5678abcd-9012-abcd-3456-7890abcd1234`, {
          name: `${DirectorService.prefix}_public-${indices[2]}-5432abcd-1098-abcd-7654-3210abcd9876`
        },
        `${DirectorService.prefix}_public-${indices[3]}-5678abcd-9012-abcd-3456-7890abcd1234`,
        'no-match'
        ], 'public');
        expect(usedIndices).to.eql(indices.splice(2, 3));
      });

    });

    describe('#getFreeIndices', () => {
      it('returns an array that contains 1234 indices', () => {
        directorService.service.subnet = null;
        setDefaultConfig();
        let freeIndices = NetworkSegmentIndex
          .getFreeIndices([`${DirectorService.prefix}-1234-5678abcd-9012-abcd-3456-7890abcd1234`], directorService.service.subnet);
        expect(freeIndices).to.have.length(1234);
      });
      it('returns an array that contains 2045 indices', () => {
        updateStub(-1);
        let freeIndices = NetworkSegmentIndex
          .getFreeIndices([`${DirectorService.prefix}_public-1234-5678abcd-9012-abcd-3456-7890abcd1234`], 'public');
        expect(freeIndices).to.have.length(2045);
      });
    });

    describe('#findFreeIndex', () => {
      it('returns 2', () => {
        setDefaultConfig();
        expect(NetworkSegmentIndex.findFreeIndex([{
          name: `${DirectorService.prefix}-9876-5432abcd-1098-abcd-7654-3210abcd9876`
        }, `${DirectorService.prefix}-1234-5678abcd-9012-abcd-3456-7890abcd1234`], directorService)).to.eql(2);
      });
    });
  });
});
