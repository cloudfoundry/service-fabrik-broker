'use strict';

const _ = require('lodash');
const DockerService = require('../src/docker-operator/DockerService');
const DockerImageLoaderService = require('../src/docker-operator/DockerImageLoaderService');
const docker = require('@sf/docker');
const { catalog } = require('@sf/models');
const parseUrl = require('url').parse;
const config = require('@sf/app-config');
const portRegistry = docker.portRegistry;
const {
  errors: {
    ServiceInstanceNotFound
  }
} = require('@sf/common-utils');

describe('docker-operator', function () {
  const instance_id = 'b3e03cb5-29cc-4fcf-9900-023cf149c554';
  const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
  const plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
  const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
  const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
  let service;
  let sampleStub;
  let willBeExhaustedSoonSpy;
  let ports = [];

  function createDockerService(instance_id, plan) {
    return new DockerService(instance_id, plan);
  }

  describe('DockerService', function () {
    /* jshint expr:true */
    before(function () {
      service = createDockerService(instance_id, catalog.getPlan(plan_id));
      sampleStub = sinon.stub(portRegistry, 'sample').callsFake(() => ports.shift());
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

  describe('#DockerService', function () {
    const parameters = {
      foo: 'bar'
    };
    const usedPorts = [38782, 44635];
    const docker_url = parseUrl(config.docker.url);
    const username = 'user';
    const password = 'secret';
    const app_guid = 'app-guid';

    before(function () {
      _.unset(DockerImageLoaderService, plan_id);
      mocks.docker.inspectImage();
      mocks.docker.getAllContainers(usedPorts);
      return mocks.setup([
        DockerImageLoaderService.load(catalog.getPlan(plan_id)),
        docker.updatePortRegistry()
      ]);
    });

    afterEach(function () {
      mocks.reset();
    });
    describe('#provision', function () {
      it('returns 201 Created', function () {
        if (_.get(config, 'feature.EnableSecurityGroupsOps', true)) {
          mocks.cloudController.createSecurityGroup(instance_id);
        }
        mocks.docker.createContainer(instance_id);
        mocks.docker.startContainer();
        mocks.docker.inspectContainer();
        const options = {
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          },
          organization_guid: organization_guid,
          space_guid: space_guid,
          parameters: parameters
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.create(options))
          .then(res => {
            expect(res).to.eql(instance_id);
            mocks.verify();
          });
      });

      it('returns 201 Created - start fails once internally', function () {
        if (_.get(config, 'feature.EnableSecurityGroupsOps', true)) {
          mocks.cloudController.createSecurityGroup(instance_id);
        }
        mocks.docker.createContainer(instance_id, 2);
        mocks.docker.startContainer(500);
        mocks.docker.deleteContainer();
        mocks.docker.getAllContainers(usedPorts);
        mocks.docker.startContainer();
        mocks.docker.inspectContainer();
        const options = {
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          },
          organization_guid: organization_guid,
          space_guid: space_guid,
          parameters: parameters
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.create(options))
          .then(res => {
            expect(res).to.eql(instance_id);
            mocks.verify();
          });
      });

      it('returns 201 Created: For K8S', function () {
        mocks.docker.createContainer(instance_id);
        mocks.docker.startContainer();
        mocks.docker.inspectContainer();
        const options = {
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'kubernetes',
            namespace: 'default'
          },
          organization_guid: organization_guid,
          space_guid: space_guid,
          parameters: parameters
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.create(options))
          .then(res => {
            expect(res).to.eql(undefined); // as no post provisioning is done
            mocks.verify();
          });
      });

    });

    describe('#update', function () {
      it('returns 200 OK', function () {
        mocks.docker.inspectContainer(instance_id);
        const options = {
          service_id: service_id,
          plan_id: plan_id,
          parameters: parameters,
          context: {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          },
          previous_values: {
            plan_id: plan_id,
            service_id: service_id
          }
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.update(options))
          .then(res => {
            expect(res).to.eql(undefined); // as ensurecontainerisrunning returns undefined if everything goes well
            mocks.verify();
          });
      });
      it('returns 200 OK : For K8S', function () {
        mocks.docker.inspectContainer(instance_id);
        const options = {
          service_id: service_id,
          plan_id: plan_id,
          parameters: parameters,
          context: {
            platform: 'kubernetes',
            namespace: 'default'
          },
          previous_values: {
            plan_id: plan_id,
            service_id: service_id
          }
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.update(options))
          .then(res => {
            expect(res).to.eql(undefined); // as ensurecontainerisrunning returns undefined if everything goes well
            mocks.verify();
          });
      });

    });

    describe('#deprovision', function () {
      it('returns 200 OK', function () {
        mocks.docker.inspectContainer(instance_id, {
          Config: {
            Env: ['context={"platform":"cloudfoundry"}']
          }
        });
        if (_.get(config, 'feature.EnableSecurityGroupsOps', true)) {
          mocks.cloudController.findSecurityGroupByName(instance_id);
          mocks.cloudController.deleteSecurityGroup(instance_id);
        }
        mocks.docker.deleteContainer();
        mocks.docker.deleteVolumes(instance_id);
        const options = {
          service_id: service_id,
          plan_id: plan_id
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.delete(options))
          .then(res => {
            expect(res).to.eql(undefined); // as deleteVolumes returns undefined if everything goes well
            mocks.verify();
          });
      });

      it('returns 410 Gone', function () {
        mocks.docker.inspectContainer(instance_id, {}, 404);
        const options = {
          service_id: service_id,
          plan_id: plan_id
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.delete(options))
          .catch(ServiceInstanceNotFound, () => {
            mocks.verify();
          });
      });

      it('returns 200 OK: for existing deployment not having platfrom-context in environment', function () {
        mocks.docker.inspectContainer(instance_id);
        if (_.get(config, 'feature.EnableSecurityGroupsOps', true)) {
          mocks.cloudController.findSecurityGroupByName(instance_id);
          mocks.cloudController.deleteSecurityGroup(instance_id);
        }
        mocks.docker.deleteContainer();
        mocks.docker.deleteVolumes(instance_id);
        const options = {
          service_id: service_id,
          plan_id: plan_id
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.delete(options))
          .then(res => {
            expect(res).to.eql(undefined); // as deleteVolumes returns undefined if everything goes well
            mocks.verify();
          });
      });

      it('returns 200 OK: In K8S platform', function () {
        mocks.docker.inspectContainer(instance_id, {
          Config: {
            Env: ['context={"platform":"kubernetes"}']
          }
        });
        mocks.docker.deleteContainer();
        mocks.docker.deleteVolumes(instance_id);
        const options = {
          service_id: service_id,
          plan_id: plan_id
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.delete(options))
          .then(res => {
            expect(res).to.eql(undefined); // as deleteVolumes returns undefined if everything goes well
            mocks.verify();
          });
      });

    });

    describe('#bind', function () {
      it('returns 201 Created', function () {
        mocks.docker.inspectContainer(instance_id);
        const options = {
          service_id: service_id,
          plan_id: plan_id,
          app_guid: app_guid,
          bind_resource: {
            app_guid: app_guid,
            space_guid: space_guid
          },
          context: {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          }
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.bind(options))
          .then(res => {
            expect(res).to.eql({
              hostname: docker_url.hostname,
              username: username,
              password: password,
              port: undefined,
              ports: {
                '12345/tcp': 12345
              },
              uri: `http://${username}:${password}@${docker_url.hostname}`
            });
            mocks.verify();
          });
      });
      it('returns 201 Created and creates Security Group for shared instance binding', function () {
        let target_space_guid = 'target_id';
        let binding_id = 'binding_id';
        mocks.docker.inspectContainer(instance_id);
        mocks.cloudController.getSpace(target_space_guid, {
          'organization_guid': organization_guid
        });
        mocks.cloudController.createSecurityGroup(binding_id);
        const options = {
          binding_id: binding_id,
          service_id: service_id,
          plan_id: plan_id,
          app_guid: app_guid,
          bind_resource: {
            app_guid: app_guid,
            space_guid: target_space_guid
          },
          context: {
            platform: 'cloudfoundry',
            organization_guid: organization_guid,
            space_guid: space_guid
          }
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.bind(options))
          .then(res => {
            expect(res).to.eql({
              hostname: docker_url.hostname,
              username: username,
              password: password,
              port: undefined,
              ports: {
                '12345/tcp': 12345
              },
              uri: `http://${username}:${password}@${docker_url.hostname}`
            });
            mocks.verify();
          });
      });
      it('returns 201 Created for requests originating from kubernetes platform', function () {
        mocks.docker.inspectContainer(instance_id);
        const options = {
          service_id: service_id,
          plan_id: plan_id,
          app_guid: app_guid,
          bind_resource: {
            app_guid: app_guid,
            space_guid: space_guid
          },
          context: {
            platform: 'kubernetes',
            organization_guid: organization_guid,
            space_guid: space_guid
          }
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.bind(options))
          .then(res => {
            expect(res).to.eql({
              hostname: docker_url.hostname,
              username: username,
              password: password,
              port: undefined,
              ports: {
                '12345/tcp': 12345
              },
              uri: `http://${username}:${password}@${docker_url.hostname}`
            });
            mocks.verify();
          });
      });
    });

    describe('#unbind', function () {
      it('returns 200 OK', function () {
        let binding_id = 'binding_id';
        mocks.cloudController.findSecurityGroupByName(binding_id);
        mocks.cloudController.deleteSecurityGroup(binding_id);
        mocks.docker.inspectContainer(instance_id, {
          Config: {
            Env: ['context={"platform":"cloudfoundry"}']
          }
        });
        const options = {
          binding_id: binding_id,
          service_id: service_id,
          plan_id: plan_id
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.unbind(options))
          .then(res => {
            expect(res).to.eql(undefined);
            mocks.verify();
          });
      });

      it('returns 200 OK: for existing deployment not having platfrom-context in environment', function () {
        let binding_id = 'binding_id';
        mocks.cloudController.findSecurityGroupByName(binding_id);
        mocks.cloudController.deleteSecurityGroup(binding_id);
        mocks.docker.inspectContainer(instance_id);
        const options = {
          binding_id: binding_id,
          service_id: service_id,
          plan_id: plan_id
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.unbind(options))
          .then(res => {
            expect(res).to.eql(undefined);
            mocks.verify();
          });
      });

      it('returns 200 OK: In K8S Platform', function () {
        mocks.docker.inspectContainer(instance_id, {
          Config: {
            Env: ['context={"platform":"kubernetes"}']
          }
        });
        const options = {
          service_id: service_id,
          plan_id: plan_id
        };
        return DockerService.createInstance(instance_id, options)
          .then(service => service.unbind(options))
          .then(res => {
            expect(res).to.eql(undefined);
            mocks.verify();
          });
      });

    });
  });

});
