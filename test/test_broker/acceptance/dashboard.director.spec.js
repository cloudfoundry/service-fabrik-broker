'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const lib = require('../../../broker/lib');
const app = require('../support/apps').external;
const fabrik = lib.fabrik;


describe('dashboard', function () {
  describe('director', function () {

    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const instance_id = 'b4719e7c-e8d3-4f7f-c51c-769ad1c3ebfa';
    const deployment_name = 'service-fabrik-0028-b4719e7c-e8d3-4f7f-c51c-769ad1c3ebfa';
    const service_plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';

    before(function () {
      _.unset(fabrik.DirectorManager, plan_id);
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
        mocks.uaa.getAccessToken();
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.cloudController.getServiceInstance(instance_id);
        mocks.cloudController.findServicePlanByInstanceId(instance_id, service_plan_guid, plan_id, undefined, 2);
        mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
          platform: 'cloudfoundry'
        });
        mocks.director.getCurrentTasks(deployment_name, [{
          'id': 324,
          'description': 'create deployment succeeded'
        }]);
        mocks.director.getCurrentTaskEvents(324, {});
        mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
          platform: 'cloudfoundry'
        });
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
            expect(res.body.instance.task.id).to.eql(`${deployment_name}_324`);
            mocks.verify();
          });
      });

      it('should redirect to authorization server(in case of no context)', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCode(service_id);
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.cloudController.getServiceInstance(instance_id);
        mocks.cloudController.findServicePlanByInstanceId(instance_id, service_plan_guid, plan_id, undefined, 2);
        mocks.director.getCurrentTasks(deployment_name, [{
          'id': 324,
          'description': 'create deployment succeeded'
        }]);
        mocks.director.getCurrentTaskEvents(324, {});
        mocks.director.getDeploymentProperty(deployment_name, false, 'platform-context', undefined);
        mocks.director.getDeploymentProperty(deployment_name, true, 'platform-context', {
          platform: 'cloudfoundry'
        });
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
            expect(res.body.instance.task.id).to.eql(`${deployment_name}_324`);
            mocks.verify();
          });
      });

    });
  });
});