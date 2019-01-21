'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const app = require('../support/apps').external;
const CONST = require('../../../common/constants');
const docker = require('../../../data-access-layer/docker');


describe('dashboard', function () {
  describe('docker', function () {

    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = '466c5078-df6e-427d-8fb2-c76af50c0f56';
    const instance_id = 'b3e03cb5-29cc-4fcf-9900-023cf149c554';
    const service_plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';
    const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';

    const resource = {
      apiVersion: 'deployment.servicefabrik.io/v1alpha1',
      kind: 'Docker',
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
            organization_guid: organization_guid,
            space_guid: space_guid
          },
          organization_guid: organization_guid,
          space_guid: space_guid,
          parameters: {
            foo: 'bar'
          }
        })
      },
      status: {
        state: 'succeeded',
        lastOperation: '{}',
        response: '{}'
      }
    };

    before(function () {
      mocks.docker.getAllContainers([]);
      return mocks.setup([
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
        mocks.cloudController.findServicePlanByInstanceId(instance_id, service_plan_guid, plan_id, undefined, 2);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, resource, 1);
        mocks.docker.inspectContainer(instance_id);
        mocks.docker.inspectContainer(instance_id);
        mocks.docker.inspectContainer();
        mocks.docker.listContainerProcesses();
        mocks.docker.getContainerLogs();
        mocks.docker.inspectImage();
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
            expect(res.body.processes).to.eql([
              ['UID', 'PID'],
              ['root', '13642']
            ]);
            mocks.verify();
          });
      });
    });

    describe('/manage/dashboards/docker/instances/:instance_id', function () {
      this.slow(1500);
      it('should redirect to authorization server', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCode(service_id);
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, instance_id, resource, 3);
        mocks.docker.inspectContainer(instance_id);
        mocks.docker.listContainerProcesses();
        mocks.docker.getContainerLogs();
        return agent
          .get(`/manage/dashboards/docker/instances/${instance_id}`)
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