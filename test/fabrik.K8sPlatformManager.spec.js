'use strict';

const lib = require('../lib');
const catalog = lib.models.catalog;
const Promise = require('bluebird');
const errors = require('../lib/errors');
const K8sPlatformManager = require('../lib/fabrik/K8sPlatformManager');
const DirectorManager = lib.fabrik.DirectorManager;
const DockerManager = lib.fabrik.DockerManager;
const NotImplemented = errors.NotImplemented;


describe('fabrik', function () {
  describe('K8sPlatformManager', function () {
    const director_plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const docker_plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
    let directorManager;
    let dockerManager;

    function createDirectorManager(plan_id) {
      return new DirectorManager(catalog.getPlan(plan_id));
    }

    function createDockerManager(plan_id) {
      return new DockerManager(catalog.getPlan(plan_id));
    }

    describe('#director', function () {
      let context = {
        platform: 'kubernetes',
        namespace: 'default'
      };
      directorManager = createDirectorManager(director_plan_id);
      let platformManager = new K8sPlatformManager('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9',
        directorManager, context);

      it('should throw NotImplemented error from  preInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DirectorManager);
        return Promise.try(() => platformManager.preInstanceProvisionOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  postInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DirectorManager);
        return Promise.try(() => platformManager.postInstanceProvisionOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  preInstanceDeleteOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DirectorManager);
        return Promise.try(() => platformManager.preInstanceDeleteOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  postInstanceUpdateOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DirectorManager);
        return Promise.try(() => platformManager.postInstanceUpdateOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  ensureTenantId', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DirectorManager);
        return Promise.try(() => platformManager.ensureTenantId({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });
    });

    describe('#docker', function () {
      let context = {
        platform: 'kubernetes',
        namespace: 'default'
      };
      dockerManager = createDockerManager(docker_plan_id);
      let platformManager = new K8sPlatformManager('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9',
        dockerManager, context);
      it('should throw NotImplemented error from  preInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DockerManager);
        return Promise.try(() => platformManager.preInstanceProvisionOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  postInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DockerManager);
        return Promise.try(() => platformManager.postInstanceProvisionOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  preInstanceDeleteOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DockerManager);
        return Promise.try(() => platformManager.preInstanceDeleteOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  postInstanceUpdateOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DockerManager);
        return Promise.try(() => platformManager.postInstanceUpdateOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });

      it('should throw NotImplemented error from  ensureTenantId', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DockerManager);
        return Promise.try(() => platformManager.ensureTenantId({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });
    });
  });
});