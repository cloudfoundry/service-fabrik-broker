'use strict';

const DockerService = require('../../managers/docker-manager/DockerService');
const portRegistry = require('../../data-access-layer/docker').portRegistry;
const catalog = require('../../common/models').catalog;

describe('docker-manager', function () {
  describe('DockerService', function () {
    /* jshint expr:true */

    const instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
    let service;
    let sampleStub;
    let willBeExhaustedSoonSpy;
    let ports = [];

    function createDockerService(instance_id, plan) {
      return new DockerService(instance_id, plan);
    }

    before(function () {
      service = createDockerService(instance_id, catalog.getPlan(plan_id));
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
    describe('#createPortBindings', function () {
      it('should return port bindings', function () {
        const exposedPorts = {
          '314/tcp': {},
          '2718/tcp': {}
        };
        return service
          .createPortBindings(exposedPorts)
          .then(portBindings => {
            expect(willBeExhaustedSoonSpy).to.be.calledTwice;
            expect(sampleStub).to.be.calledTwice.and.calledWith('tcp');
            expect(portBindings).to.eql({
              '314/tcp': [{
                HostPort: '32768'
              }],
              '2718/tcp': [{
                HostPort: '32769'
              }]
            });
          });
      });
    });
  });
});