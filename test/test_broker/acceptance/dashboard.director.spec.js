'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const CONST = require('../../../common/constants');
const app = require('../support/apps').external;

describe('dashboard', function () {
  describe('director', function () {

    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const instance_id = 'b4719e7c-e8d3-4f7f-c51c-769ad1c3ebfa';
    const deployment_name = 'service-fabrik-0028-b4719e7c-e8d3-4f7f-c51c-769ad1c3ebfa';
    const service_plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';

    const resource = {
      apiVersion: 'deployment.servicefabrik.io/v1alpha1',
      kind: 'Director',
      metadata: {
        name: instance_id,
        labels: {
          state: 'succeeded'
        }
      },
      spec: {
        options: JSON.stringify({
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry',
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
          },
          organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
          space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
          parameters: {
            foo: 'bar'
          }
        })
      },
      status: {
        state: 'succeeded',
        lastOperation: '{}',
        response: '{}',
        appliedOptions: JSON.stringify({
          service_id: service_id,
          plan_id: plan_id,
          context: {
            platform: 'cloudfoundry',
            organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
            space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a'
          },
          organization_guid: 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a',
          space_guid: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
          parameters: {
            foo: 'bar'
          }
        })
      }
    };

    // before(function () {
    //   _.unset(fabrik.DirectorManager, plan_id);
    // });

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
        mocks.cloudController.findServicePlanByInstanceId(instance_id, service_plan_guid, plan_id, undefined, 2);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resource, 3);
        mocks.director.getCurrentTasks(deployment_name, [{
          'id': 324,
          'description': 'create deployment succeeded'
        }]);
        mocks.director.getCurrentTaskEvents(324, {});
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
            expect(res.body.instance.metadata.name).to.equal(instance_id);
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
        mocks.cloudController.findServicePlanByInstanceId(instance_id, service_plan_guid, plan_id, undefined, 2);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resource, 3);
        mocks.director.getCurrentTasks(deployment_name, [{
          'id': 324,
          'description': 'create deployment succeeded'
        }]);
        mocks.director.getCurrentTaskEvents(324, {});
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
            expect(res.body.instance.metadata.name).to.equal(instance_id);
            expect(res.body.instance.task.id).to.eql(`${deployment_name}_324`);
            mocks.verify();
          });
      });

    });

    describe('/manage/dashboards/:instance_type/instances/:instance_id', function () {
      beforeEach(function () {
        mocks.reset();
      });

      this.slow(1500);
      it('should redirect to authorization server', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCode(service_id);
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resource, 3);
        mocks.director.getCurrentTasks(deployment_name, [{
          'id': 324,
          'description': 'create deployment succeeded'
        }]);
        mocks.director.getCurrentTaskEvents(324, {});
        return agent
          .get(`/manage/dashboards/director/instances/${instance_id}`)
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
            expect(res.body.instance.metadata.name).to.equal(instance_id);
            expect(res.body.instance.task.id).to.eql(`${deployment_name}_324`);
            mocks.verify();
          });
      });

      it('should use spec.options to fetch resource data when status.appliedOptions is not present', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCode(service_id);
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        _.unset(resource, 'status.appliedOptions');
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resource, 3);
        mocks.director.getCurrentTasks(deployment_name, [{
          'id': 324,
          'description': 'create deployment succeeded'
        }]);
        mocks.director.getCurrentTaskEvents(324, {});
        return agent
          .get(`/manage/dashboards/director/instances/${instance_id}`)
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
            expect(res.body.instance.metadata.name).to.equal(instance_id);
            expect(res.body.instance.task.id).to.eql(`${deployment_name}_324`);
            mocks.verify();
            _.set(resource, 'status.appliedOptions', _.get(resource, 'spec.options'));
          });
      });

      it('should handle login_hint query param if present', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCodeLoginHint(service_id);
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, resource, 3);
        mocks.director.getCurrentTasks(deployment_name, [{
          'id': 324,
          'description': 'create deployment succeeded'
        }]);
        mocks.director.getCurrentTaskEvents(324, {});
        return agent
          .get(`/manage/dashboards/director/instances/${instance_id}?login_hint=uaa`)
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
            expect(res.body.instance.metadata.name).to.equal(instance_id);
            expect(res.body.instance.task.id).to.eql(`${deployment_name}_324`);
            mocks.verify();
          });
      });
      it('should throw exception NotFound', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        return agent
          .get(`/manage/dashboards/random/instances/${instance_id}`)
          .set('Accept', 'application/json')
          .set('X-Forwarded-Proto', 'https')
          .redirects(2)
          .catch(err => err.response)
          .then(res => {
            expect(res).to.have.status(404);
            mocks.verify();
          });
      });
    });

  });
});