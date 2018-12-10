'use strict';

const fabrik = require('../../broker/lib/fabrik/Fabrik');
const config = require('../../common/config');
const portRegistry = require('../../data-access-layer/docker').portRegistry;
const catalog = require('../../common/models').catalog;
const DockerManager = require('../../broker/lib/fabrik').DockerManager;

describe('fabrik', function () {
  describe('DockerManager', function () {
    /* jshint expr:true */

    const plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
    let manager;
    let sampleStub;
    let willBeExhaustedSoonSpy;
    let ports = [];

    function createManager(plan_id) {
      return new DockerManager(catalog.getPlan(plan_id));
    }

    before(function () {
      manager = createManager(plan_id);
      sampleStub = sinon.stub(portRegistry, 'sample', () => ports.shift());
      willBeExhaustedSoonSpy = sinon.spy(portRegistry, 'willBeExhaustedSoon');
    });

    beforeEach(function () {
      ports = [32768, 32769];
    });

    after(function () {
      portRegistry.willBeExhaustedSoon.restore();
      portRegistry.sample.restore();
    });
    describe('#createManager', function () {
      it('Should return assertion error for docker plan', function () {
        config.enable_swarm_manager = false;
        return fabrik.createManager(catalog.getPlan(plan_id))
          .catch(err => {
            expect(err.message).to.eql('\'docker\' in [ \'director\', \'virtual_host\' ]');
            config.enable_swarm_manager = true;
          });
      });
    });
  });
});