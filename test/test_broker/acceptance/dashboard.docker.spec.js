'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const lib = require('../../../broker/lib');
const app = require('../support/apps').external;
const catalog = require('../../../common/models').catalog;
const docker = require('../../../data-access-layer/docker');
const fabrik = lib.fabrik;


describe('dashboard', function () {
  describe('docker', function () {

    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
    const instance_id = 'b3e03cb5-29cc-4fcf-9900-023cf149c554';
    const service_plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';
    const plan = catalog.getPlan(plan_id);

    before(function () {
      _.unset(fabrik.DockerManager, plan_id);
      mocks.docker.inspectImage();
      mocks.docker.getAllContainers([]);
      return mocks.setup([
        fabrik.DockerManager.load(plan),
        docker.updatePortRegistry()
      ]);
    });

    afterEach(function () {
      mocks.reset();
    });

    describe('/manage/instances/:service_id/:plan_id/:instance_id', function () {
      this.slow(1500);

      it('should redirect to authorization server', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCode(service_id);
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.cloudController.getServiceInstance(instance_id);
        mocks.cloudController.findServicePlanByInstanceId(instance_id, service_plan_guid, plan_id, undefined, 2);
        mocks.docker.inspectContainer(instance_id);
        mocks.docker.inspectContainer(instance_id);
        mocks.docker.inspectContainer();
        mocks.docker.listContainerProcesses();
        mocks.docker.getContainerLogs();
        return agent
          .get(`/manage/instances/${service_id}/${plan_id}/${instance_id}`)
          .set('Accept', 'application/json')
          .set('X-Forwarded-Proto', 'https')
          .redirects(2)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(302);
            const location = parseUrl(res.headers.location);
            expect(location.pathname).to.equal('/manage/auth/cf/callback');
            expect(_
              .chain(res.redirects)
              .map(parseUrl)
              .map(url => url.pathname)
              .value()
            ).to.eql([
              '/manage/auth/cf',
              '/oauth/authorize'
            ]);
            return location;
          })
          .then(location => agent
            .get(location.path)
            .set('Accept', 'application/json')
            .set('X-Forwarded-Proto', 'https')
          )
          .then(res => {
            expect(res.body.userId).to.equal('me');
            expect(res.body.instance.metadata.guid).to.equal(instance_id);
            expect(res.body.processes).to.eql([
              ['UID', 'PID'],
              ['root', '13642']
            ]);
            mocks.verify();
          });
      });

    });
  });
});