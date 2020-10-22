'use strict';

const _ = require('lodash');
const { CONST } = require('@sf/common-utils');
const parseUrl = require('url').parse;
const app = require('../../../../test/test_broker/support/apps').external;

describe('dashboard', function () {
  describe('virtualHost', function () {

    const service_id = '19f17a7a-5247-4ee2-94b5-03eac6756388';
    const plan_id = 'd035f948-5d3a-43d7-9aec-954e134c3e9d';
    const plan_guid = 'f6280923-b144-4f02-adf7-76a7b5ef3a4a';
    const instance_id = '5a877873-7659-40ea-bdcb-096e9ae0cbb3';
    const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const parent_instance_id = 'b4719e7c-e8d3-4f7f-c51c-769ad1c3ebfa';
    const deployment_name = 'service-fabrik-0028-b4719e7c-e8d3-4f7f-c51c-769ad1c3ebfa';
    const instance_name = 'rmq';

    const resource1 = {
      apiVersion: 'deployment.servicefabrik.io/v1alpha1',
      kind: 'VirtualHost',
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
            dedicated_rabbitmq_instance: `${instance_name}`
          }
        })
      },
      operatorMetadata: {
        deploymentName: `${deployment_name}`
      },
      status: {
        state: 'succeeded',
        lastOperation: '{}',
        response: '{}'
      }
    };

    const resource2 = {
      apiVersion: 'deployment.servicefabrik.io/v1alpha1',
      kind: 'Director',
      metadata: {
        name: parent_instance_id,
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
          space_guid: space_guid
        })
      },
      status: {
        state: 'succeeded',
        lastOperation: '{}',
        response: '{}'
      }
    };

    describe('/manage/instances/:service_id/:plan_id/:instance_id', function () {

      afterEach(function () {
        mocks.reset();
      });

      this.slow(1500);
      it('should redirect to authorization server', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCodeLoginHint(service_id, 1, 'sap.ids');
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, resource1, 2);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, parent_instance_id, resource2, 1);
        mocks.cloudController.findServicePlanByInstanceId(instance_id, plan_guid, plan_id, undefined, 2);
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
            expect(res.body.parent_instance.metadata.name).to.equal(parent_instance_id);
            mocks.verify();
          });
      });
    });

    describe('/manage/dashboards/virtual_host/instances/:instance_id', function () {

      afterEach(function () {
        mocks.reset();
      });

      this.slow(1500);
      it('should redirect to authorization server', function () {
        const agent = chai.request.agent(app);
        agent.app.listen(0);
        mocks.uaa.getAuthorizationCodeLoginHint(service_id, 1, 'sap.ids');
        mocks.uaa.getAccessTokenWithAuthorizationCode(service_id);
        mocks.uaa.getUserInfo();
        mocks.cloudController.getServiceInstancePermissions(instance_id);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, instance_id, resource1, 3);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, parent_instance_id, resource2, 1);
        return agent
          .get(`/manage/dashboards/virtual_host/instances/${instance_id}`)
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
            expect(res.body.parent_instance.metadata.name).to.equal(parent_instance_id);
            mocks.verify();
          });
      });
    });
  });
});
