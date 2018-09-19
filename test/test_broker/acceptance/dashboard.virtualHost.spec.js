'use strict';

const _ = require('lodash');
const parseUrl = require('url').parse;
const lib = require('../../../broker/lib');
const app = require('../support/apps').external;
const fabrik = lib.fabrik;
const iaas = require('../../../data-access-layer/iaas');
const virtualHostStore = iaas.virtualHostStore;
const config = require('../../../common/config');

describe('dashboard', function () {
  describe('virtualHost', function () {

    const service_id = '19f17a7a-5247-4ee2-94b5-03eac6756388';
    const plan_id = 'd035f948-5d3a-43d7-9aec-954e134c3e9d';
    const plan_guid = 'f6280923-b144-4f02-adf7-76a7b5ef3a4a';
    const index = mocks.director.networkSegmentIndex;
    const instance_id = mocks.director.uuidByIndex(index);
    const parent_instance_id = 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
    const deployment_name = mocks.director.deploymentNameByIndex(index);
    const filename = `virtual_hosts/${instance_id}/${instance_id}.json`;
    const container = virtualHostStore.containerName;
    const pathname = `/${container}/${filename}`;
    const data = {
      instance_guid: instance_id,
      deployment_name: deployment_name
    };
    before(function () {
      _.unset(fabrik.VirtualHostManager, plan_id);
      virtualHostStore.cloudProvider = new iaas.CloudProviderClient(config.virtual_host.provider);
      mocks.cloudProvider.auth();
      mocks.cloudProvider.getContainer(container);
      return mocks.setup([
        virtualHostStore.cloudProvider.getContainer()
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
        mocks.cloudController.getServiceInstance(parent_instance_id);
        mocks.cloudController.findServicePlanByInstanceId(instance_id, plan_guid, plan_id, undefined, 3);
        mocks.cloudProvider.download(pathname, data);
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
            expect(res.body.parent_instance.metadata.guid).to.equal(parent_instance_id);
            mocks.verify();
          });
      });
    });
  });
});