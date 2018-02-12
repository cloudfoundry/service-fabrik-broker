'use strict';

const lib = require('../lib');
const catalog = lib.models.catalog;
const Promise = require('bluebird');
const errors = require('../lib/errors');
const CfPlatformManager = require('../lib/fabrik/CfPlatformManager');
const DirectorManager = lib.fabrik.DirectorManager;
const DockerManager = lib.fabrik.DockerManager;
const NotImplemented = errors.NotImplemented;


describe('fabrik', function () {
  describe('CfPlatformManager', function () {
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
        platform: 'cloudfoundry',
        space_guid: '1a6e7c34-d97c-4fc0-95e6-7a3bc8030be1',
        organization_guid: '2a6e7c34-d97c-4fc0-95e6-7a3bc8030be2'
      };
      directorManager = createDirectorManager(director_plan_id);
      let platformManager = new CfPlatformManager('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9',
        directorManager, context);
      it('should throw NotImplemented error from  preInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.space_guid).to.eql(context.space_guid);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DirectorManager);
        return Promise.try(() => platformManager.preInstanceProvisionOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });
    });

    describe('#docker', function () {
      let context = {
        platform: 'cloudfoundry',
        space_guid: '1a6e7c34-d97c-4fc0-95e6-7a3bc8030be1',
        organization_guid: '2a6e7c34-d97c-4fc0-95e6-7a3bc8030be2'
      };
      dockerManager = createDockerManager(docker_plan_id);
      let platformManager = new CfPlatformManager('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9',
        dockerManager, context);
      it('should throw NotImplemented error from  preInstanceProvisionOperations', function () {
        expect(platformManager.guid).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
        expect(platformManager.platform).to.eql(context.platform);
        expect(platformManager.space_guid).to.eql(context.space_guid);
        expect(platformManager.context).to.eql(context);
        expect(platformManager.manager).to.be.instanceof(DockerManager);
        return Promise.try(() => platformManager.preInstanceProvisionOperations({}))
          .catch(err => {
            expect(err).to.be.instanceof(NotImplemented);
          });
      });
    });

  });
});