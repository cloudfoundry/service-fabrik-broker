'use strict';

const Promise = require('bluebird');
const uuid = require('uuid');
const _ = require('lodash');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const config = require('../../common/config');
const logger = require('../../common/logger');
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;
const BoshDirectorClient = require('../../data-access-layer/bosh/BoshDirectorClient');
const utils = require('../../common/utils');
const HttpClient = utils.HttpClient;
const UaaClient = require('../../data-access-layer/cf/UaaClient');
const TokenIssuer = require('../../data-access-layer/cf/TokenIssuer');
const eventmesh = require('../../data-access-layer/eventmesh');
const yaml = require('js-yaml');
const assert = require('assert');
const id = uuid.v4();
const deployment_name = id;
const taskId = Math.floor(Math.random() * 123456789);
const bosh_taskId = `bosh_${taskId}`;
let populateConfigCacheInProgress = false;
const manifest = yaml.safeDump({
  name: id
});
let primary_config = _.sample(_
  .filter(config.directors, function (director) {
    return director.support_create && director.primary;
  }));

class MockBoshDirectorClient extends BoshDirectorClient {
  constructor(request, response) {
    super();
    this.req = request || {};
    this.res = _.defaults(response, {
      body: {},
      statusCode: -1,
      headers: {}
    });
  }

  makeRequest(options, expectedStatusCode) {
    switch (this.res.statusCode) {
    case 400:
      this.res.statusCode = 204;
      return Promise.reject(new BadRequest(''));
    case 404:
      this.res.statusCode = 204;
      return Promise.reject(new NotFound(''));
    default:
      expect(expectedStatusCode).to.equal(this.res.statusCode);
      expect(_.omit(options, 'body')).to.eql(_.omit(this.req, 'body'));

      return Promise.resolve({
        body: this.res.body,
        statusCode: this.res.statusCode,
        headers: this.res.headers
      });
    }
  }

  makeRequestWithConfig(options, expectedStatusCode) {
    switch (this.res.statusCode) {
    case 400:
      this.res.statusCode = 204;
      return Promise.reject(new BadRequest(''));
    case 404:
      this.res.statusCode = 204;
      return Promise.reject(new NotFound(''));
    default:
      expect(expectedStatusCode).to.equal(this.res.statusCode);
      expect(_.omit(options, 'body')).to.eql(_.omit(this.req, 'body'));

      return Promise.resolve({
        body: this.res.body,
        statusCode: this.res.statusCode,
        headers: this.res.headers
      });
    }
  }

  populateConfigCache() {
    this.boshConfigCache = {};
    this.cacheLoadInProgress = populateConfigCacheInProgress;
    logger.info(`Stubbed populate cache - cache load in-progress : ${populateConfigCacheInProgress}`);
    this.boshConfigCache[deployment_name] = primary_config;
  }
}

describe('bosh', () => {
  describe('BoshDirectorClient', () => {

    describe('#constructor', () => {
      it('initializes variables', () => {
        const dc = new MockBoshDirectorClient();
        expect(dc.boshConfigCache).to.be.an('object');
      });
    });

    describe('#getDirectorForOperation', function () {
      it('should return the active primary as the director for create operations', function () {
        return new MockBoshDirectorClient({}, {}).getDirectorForOperation('create', deployment_name)
          .then((out) => {
            expect(out).to.eql(MockBoshDirectorClient.getActivePrimary()[0]);
          });
      });

      it('should return the director for non-create operations', function () {
        return new MockBoshDirectorClient({}, {}).getDirectorForOperation('update', deployment_name)
          .then((out) => {
            expect(out).to.not.eql(undefined);
          });
      });
    });

    describe('#getInfrastructure', () => {
      it('return the object with infrastructure details', () => {
        expect(MockBoshDirectorClient.getInfrastructure()).to.be.instanceof(Object);
        expect(MockBoshDirectorClient.getInfrastructure().stemcell).to.be.instanceof(Object);
        expect(MockBoshDirectorClient.getInfrastructure().segmentation).to.be.instanceof(Object);
      });
    });

    describe('#getActivePrimary', () => {
      it('gets the configs which are primary and supports create', () => {
        const val = MockBoshDirectorClient.getActivePrimary();
        expect(val).to.be.instanceof(Array);
        expect(val[0].primary).to.eql(true);
        expect(val[0].support_create).to.eql(true);
      });
    });

    describe('#getConfigByName', () => {
      it('gets the config by BOSH director name', () => {
        expect(new MockBoshDirectorClient().getConfigByName('bosh').name).to.eql('bosh');
      });
    });

    describe('#getOobDirectorConfigs', () => {
      it('gets the config which is only for out of band backup', () => {
        const val = MockBoshDirectorClient.getOobDirectorConfigs();
        // we dont include OobDirectors in test config at this point.
        expect(val).to.eql([]);
      });
    });

    // #getDirectorConfig is currently covered in Acceptance Test. Need to add unit test here.

    describe('#clearConfigCache', () => {
      it('empties the cache', () => {
        const dc = new MockBoshDirectorClient();
        dc.clearConfigCache();
        expect(dc.boshConfigCache).to.eql({});
      });
    });

    describe('#getInfo', () => {
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: '/info'
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };

        new MockBoshDirectorClient(request, response).getInfo().then((content) => {
          expect(content).to.eql(JSON.parse(response.body));
          done();
        }).catch(done);
      });
    });

    describe('#getCurrentTasks', () => {
      before(function () {

      });
      after(function () {});
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: '/tasks',
          qs: {
            state: 'processing,cancelling',
            verbose: 2
          }
        };
        let response = {
          body: JSON.stringify([{
              id: 1,
              state: 'processing',
              context_id: 'Fabrik::Operation::Auto'
            },
            {
              id: 2,
              state: 'cancelling',
              context_id: 'Fabrik::Operation::Auto'
            },
            {
              id: 3,
              state: 'processing',
              context_id: 'Fabrik::Operation::create'
            },
            {
              id: 4,
              state: 'cancelling',
              context_id: 'Fabrik::Operation::update'
            },
            {
              id: 5,
              state: 'processing'
            }
          ]),
          statusCode: 200
        };
        new MockBoshDirectorClient(request, response).getCurrentTasks().then((content) => {
          expect(content).to.eql({
            create: 1,
            update: 1,
            delete: 0,
            scheduled: 2,
            uncategorized: 1,
            total: 5
          });
          done();
        }).catch(done);
      });

    });

    describe('#getDeployments', () => {
      let clock;
      before(function () {
        clock = sinon.useFakeTimers();
      });
      after(function () {
        clock.restore();
      });
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: '/deployments'
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };
        new MockBoshDirectorClient(request, response).getDeployments().then((content) => {
          expect(content).to.eql([JSON.parse(response.body)]);
          done();
        }).catch(done);
      });

      it('returns deployment names from cache', (done) => {
        let request = {
          method: 'GET',
          url: '/deployments'
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };
        new MockBoshDirectorClient(request, response).getDeploymentNamesFromCache().then((content) => {
          expect(content).to.eql([deployment_name]);
          done();
        }).catch(done);
      });
      it('returns deployment names from cache for input bosh', (done) => {
        let request = {
          method: 'GET',
          url: '/deployments'
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };
        new MockBoshDirectorClient(request, response).getDeploymentNamesFromCache('bosh').then((content) => {
          expect(content).to.eql([deployment_name]);
          done();
        }).catch(done);
      });
      it('waits in case of cache load if cache details are to be returned back', (done) => {
        let request = {
          method: 'GET',
          url: '/deployments'
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };
        populateConfigCacheInProgress = true;
        const director = new MockBoshDirectorClient(request, response);
        const deployments = director
          .getDeploymentNamesFromCache('bosh').then((content) => {
            expect(content).to.eql([deployment_name]);
            done();
          }).catch(done);
        populateConfigCacheInProgress = false;
        director.populateConfigCache();
        clock.tick(500);
        return deployments;
      });
    });

    describe('#getDeployment', () => {
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: `/deployments/${id}`
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };

        new MockBoshDirectorClient(request, response).getDeployment(id).then((content) => {
          expect(content).to.eql(JSON.parse(response.body));
          done();
        }).catch(done);
      });
    });

    describe('#getDeploymentManifest', () => {
      it('returns a YAML object', (done) => {
        let request = {
          method: 'GET',
          url: `/deployments/${id}`
        };
        let response = {
          body: JSON.stringify({
            manifest: id
          }),
          statusCode: 200
        };

        new MockBoshDirectorClient(request, response).getDeploymentManifest(id).then((content) => {
          expect(content).to.eql(id);
          done();
        }).catch(done);
      });
    });

    describe('#createOrUpdateDeployment', () => {
      it('returns an integer (task-id): mongodb update', (done) => {
        let taskId = Math.floor(Math.random() * 123456789);
        let request = {
          method: 'POST',
          url: '/deployments',
          headers: {
            'Content-Type': 'text/yaml',
            'X-Bosh-Context-Id': CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP_AUTO
          },
          qs: undefined,
          body: manifest
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 302,
          headers: {
            location: `https://192.168.50.4:25555/a/link/to/the/task/resource/${taskId}`
          }
        };
        new MockBoshDirectorClient(request, response)
          .createOrUpdateDeployment(CONST.OPERATION_TYPE.UPDATE, manifest, null, true, true)
          .then((content) => {
            expect(content).to.eql(`${deployment_name}_${taskId}`);
            done();
          })
          .catch(done);
      });
      it('returns an integer (task-id): scheduled instance update', (done) => {
        let taskId = Math.floor(Math.random() * 123456789);
        let request = {
          method: 'POST',
          url: '/deployments',
          headers: {
            'Content-Type': 'text/yaml',
            'X-Bosh-Context-Id': CONST.BOSH_RATE_LIMITS.BOSH_FABRIK_OP_AUTO
          },
          qs: undefined,
          body: manifest
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 302,
          headers: {
            location: `https://192.168.50.4:25555/a/link/to/the/task/resource/${taskId}`
          }
        };
        new MockBoshDirectorClient(request, response)
          .createOrUpdateDeployment(CONST.OPERATION_TYPE.UPDATE, manifest, null, true)
          .then((content) => {
            expect(content).to.eql(`${deployment_name}_${taskId}`);
            done();
          })
          .catch(done);
      });
      it('returns an integer (task-id): user-triggered create', (done) => {
        let taskId = Math.floor(Math.random() * 123456789);
        let request = {
          method: 'POST',
          url: '/deployments',
          headers: {
            'Content-Type': 'text/yaml',
            'X-Bosh-Context-Id': 'Fabrik::Operation::create'
          },
          qs: undefined,
          body: manifest
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 302,
          headers: {
            location: `https://192.168.50.4:25555/a/link/to/the/task/resource/${taskId}`
          }
        };
        new MockBoshDirectorClient(request, response)
          .createOrUpdateDeployment(CONST.OPERATION_TYPE.CREATE, manifest)
          .then((content) => {
            expect(content).to.eql(`${deployment_name}_${taskId}`);
            done();
          })
          .catch(done);
      });
      it('returns an integer (task-id): user-triggered update', (done) => {
        let taskId = Math.floor(Math.random() * 123456789);
        let request = {
          method: 'POST',
          url: '/deployments',
          headers: {
            'Content-Type': 'text/yaml',
            'X-Bosh-Context-Id': 'Fabrik::Operation::update'
          },
          qs: undefined,
          body: manifest
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 302,
          headers: {
            location: `https://192.168.50.4:25555/a/link/to/the/task/resource/${taskId}`
          }
        };
        new MockBoshDirectorClient(request, response)
          .createOrUpdateDeployment(CONST.OPERATION_TYPE.UPDATE, manifest)
          .then((content) => {
            expect(content).to.eql(`${deployment_name}_${taskId}`);
            done();
          })
          .catch(done);
      });
    });

    describe('#deleteDeployment', () => {
      it('returns an integer (task-id)', (done) => {
        let taskId = Math.floor(Math.random() * 123456789);
        let request = {
          method: 'DELETE',
          url: `/deployments/${deployment_name}`
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 302,
          headers: {
            location: `https://192.168.50.4:25555/a/link/to/the/task/resource/${taskId}`
          }
        };

        new MockBoshDirectorClient(request, response).deleteDeployment(id).then((content) => {
          expect(content).to.eql(`${deployment_name}_${taskId}`);
          done();
        }).catch(done);
      });
    });

    describe('#getDeploymentVms', () => {
      it('returns a JSON object', () => {
        const vm = {};
        const vms = [vm];
        let request = {
          method: 'GET',
          url: `/deployments/${id}/vms`
        };
        let response = {
          body: JSON.stringify(vms),
          statusCode: 200
        };

        return new MockBoshDirectorClient(request, response)
          .getDeploymentVms(id)
          .then(body => expect(body).to.eql(vms));
      });
    });

    describe('#getDeploymentInstances', () => {
      it('returns the instance details of input deployment name', () => {
        const vm = {
          cid: '081e3263-e066-4a5a-868f-b420c72a260d',
          job: 'blueprint_z1',
          ips: ['10.244.10.160'],
          index: 0
        };
        const vms = [vm];
        let request = {
          method: 'GET',
          url: `/deployments/${id}/instances`
        };
        let response = {
          body: JSON.stringify(vms),
          statusCode: 200
        };

        return new MockBoshDirectorClient(request, response)
          .getDeploymentInstances(id)
          .then(body => expect(body).to.eql(vms));
      });
    });

    describe('#getDeploymentProperties', () => {
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: `/deployments/${id}/properties`
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };

        new MockBoshDirectorClient(request, response).getDeploymentProperties(id).then((content) => {
          expect(content).to.eql(JSON.parse(response.body));
          done();
        }).catch(done);
      });
    });

    describe('#createDeploymentProperty', () => {
      it('returns correct status code', (done) => {
        let request = {
          method: 'POST',
          url: `/deployments/${id}/properties`,
          json: true,
          body: {}
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 204
        };

        new MockBoshDirectorClient(request, response).createDeploymentProperty(id).then((content) => {
          expect(content.statusCode).to.eql(204);
          done();
        }).catch(done);
      });
    });

    describe('#updateDeploymentProperty', () => {
      it('returns correct status code', (done) => {
        let request = {
          method: 'PUT',
          url: `/deployments/${id}/properties/${id}`,
          json: true,
          body: {
            value: id
          }
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 204
        };

        new MockBoshDirectorClient(request, response).updateDeploymentProperty(id, id, id).then((content) => {
          expect(content.statusCode).to.eql(204);
          done();
        }).catch(done);
      });
    });

    describe('#stopDeployment', () => {
      let sandbox, getDirectorConfigStub, request, response;
      let mockBoshDirectorClient;
      beforeEach(() => {
        sandbox = sinon.sandbox.create();
        request = {
          method: 'PUT',
          url: `/deployments/${deployment_name}/jobs/*`,
          qs: {
            state: 'stopped'
          },
          headers: {
            'content-type': 'text/yaml'
          }
        };
        response = {
          statusCode: 302,
          headers: {
            location: '/tasks/taskId'
          }
        };
        mockBoshDirectorClient = new MockBoshDirectorClient(request, response);
        getDirectorConfigStub = sandbox.stub(mockBoshDirectorClient, 'getDirectorConfig');
        getDirectorConfigStub
          .withArgs(deployment_name)
          .returns(Promise.try(() => {
            return {
              key: 1234
            };
          }));
      });
      it('sends start signal for deployment', () => {
        return mockBoshDirectorClient.stopDeployment(id)
          .then(taskId => {
            expect(taskId).to.equal('taskId');
          });
      });
    });

    describe('#startDeployment', () => {
      let sandbox, getDirectorConfigStub, request, response;
      let mockBoshDirectorClient;
      beforeEach(() => {
        sandbox = sinon.sandbox.create();
        request = {
          method: 'PUT',
          url: `/deployments/${deployment_name}/jobs/*`,
          qs: {
            state: 'started'
          },
          headers: {
            'content-type': 'text/yaml'
          }
        };
        response = {
          statusCode: 302,
          headers: {
            location: '/tasks/taskId'
          }
        };
        mockBoshDirectorClient = new MockBoshDirectorClient(request, response);
        getDirectorConfigStub = sandbox.stub(mockBoshDirectorClient, 'getDirectorConfig');
        getDirectorConfigStub
          .withArgs(deployment_name)
          .returns(Promise.try(() => {
            return {
              key: 1234
            };
          }));
      });
      it('sends start signal for deployment', () => {
        return mockBoshDirectorClient.startDeployment(id)
          .then(taskId => {
            expect(taskId).to.equal('taskId');
          });
      });
    });

    describe('#createOrUpdateDeploymentProperty', () => {
      it('returns correct status code', (done) => {
        let request = {
          method: 'PUT',
          url: `/deployments/${id}/properties/${id}`,
          json: true,
          body: {
            value: id
          }
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 400
        };

        new MockBoshDirectorClient(request, response).createOrUpdateDeploymentProperty(id, id, id)
          .then(() => {
            done();
          })
          .catch((content) => {
            expect(content.statusCode).to.eql(204);
            done();
          });
      });
    });

    describe('#updateOrCreateDeploymentProperty', () => {
      it('returns correct status code', (done) => {
        let request = {
          method: 'POST',
          url: `/deployments/${id}/properties`,
          json: true,
          body: {
            name: id,
            value: id
          }
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 404
        };

        new MockBoshDirectorClient(request, response).updateOrCreateDeploymentProperty(id, id, id)
          .then(() => {
            done();
          })
          .catch((content) => {
            expect(content.statusCode).to.eql(204);
            done();
          });
      });
    });

    describe('#getDeploymentProperty', () => {
      it('returns an integer (task-id)', (done) => {
        let request = {
          method: 'GET',
          url: `/deployments/${id}/properties/${id}`
        };
        let response = {
          body: JSON.stringify({
            value: id
          }),
          statusCode: 200
        };

        new MockBoshDirectorClient(request, response).getDeploymentProperty(id, id).then((content) => {
          expect(content).to.eql(id);
          done();
        }).catch(done);
      });
    });

    describe('#deleteDeploymentProperty', () => {
      it('returns correct status code', (done) => {
        let request = {
          method: 'DELETE',
          url: `/deployments/${id}/properties/${id}`
        };
        let response = {
          statusCode: 204
        };

        new MockBoshDirectorClient(request, response).deleteDeploymentProperty(id, id).then((content) => {
          expect(content.statusCode).to.eql(204);
          done();
        }).catch(done);
      });
    });

    describe('#getTasks', () => {
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: '/tasks',
          qs: {
            deployment: deployment_name,
            limit: 1000
          }
        };
        let response = {
          body: JSON.stringify([{
            id: 1234,
            uuid: uuid.v4()
          }]),
          statusCode: 200
        };

        new MockBoshDirectorClient(request, response).getTasks({
          deployment: deployment_name
        }).then((content) => {
          let body = JSON.parse(response.body)[0];
          body.id = `${deployment_name}_${body.id}`;
          expect(content).to.eql([body]);
          done();
        }).catch(done);
      });

      let sandbox, getDirectorConfigStub, mockBoshDirectorClient, request, response;
      before(function () {
        request = {
          method: 'GET',
          url: '/tasks',
          qs: {
            deployment: deployment_name,
            limit: 1000
          }
        };
        response = {
          body: JSON.stringify([{
            id: 1234,
            uuid: uuid.v4()
          }]),
          statusCode: 200
        };

        mockBoshDirectorClient = new MockBoshDirectorClient(request, response);

        sandbox = sinon.sandbox.create();
        getDirectorConfigStub = sandbox.stub(mockBoshDirectorClient, 'getDirectorConfig');
        getDirectorConfigStub
          .withArgs(deployment_name)
          .returns(Promise.try(() => {
            return {
              key: 1234
            };
          }));
      });

      after(function () {
        sandbox.restore();
      });

      it('should call getDirectorConfig when true passed for fetchDirectorForDeployment', function (done) {
        /* jshint expr:true */
        mockBoshDirectorClient.getTasks({
          deployment: deployment_name
        }, true).then((content) => {
          let body = JSON.parse(response.body)[0];
          body.id = `${deployment_name}_${body.id}`;
          expect(content).to.eql([body]);
          expect(getDirectorConfigStub).to.be.calledOnce;
          done();
        }).catch(done);
      });
    });

    describe('#getTask', () => {
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: `/tasks/${taskId}`
        };
        let response = {
          body: JSON.stringify({
            uuid: uuid.v4()
          }),
          statusCode: 200
        };

        new MockBoshDirectorClient(request, response).getTask(bosh_taskId).then((content) => {
          expect(content).to.eql(JSON.parse(response.body));
          done();
        }).catch(done);
      });
    });

    describe('#getTaskResult', () => {
      it('returns a JSON object', (done) => {
        let request = {
          method: 'GET',
          url: `/tasks/${taskId}/output`,
          qs: {
            type: 'result'
          }
        };
        const body = {
          uuid: uuid.v4()
        };
        let response = {
          body: JSON.stringify(body),
          statusCode: 200
        };

        return new MockBoshDirectorClient(request, response).getTaskResult(bosh_taskId).then((content) => {
          expect(content).to.eql([body]);
          done();
        });
      });
    });

    describe('#getTaskEvents', () => {
      it('returns a JSON object even in case of errorneous partial response body', () => {
        let id1 = uuid.v4();
        let id2 = uuid.v4();
        let request = {
          method: 'GET',
          url: `/tasks/${taskId}/output`,
          qs: {
            type: 'event'
          }
        };
        let response = {
          body: `{\"uuid\": \"${id1}\"}\n{\"uuid\": \"${id2}\"}\n{"uuid": ${id2}}\n`,
          statusCode: 200
        };
        //Purposefully json is created errorneously to handle error scenarios.
        return new MockBoshDirectorClient(request, response).getTaskEvents(bosh_taskId).then((content) => {
          expect(content).to.be.a('Array');
          expect(content).to.have.length(2);
          expect(content[0].uuid).to.eql(id1);
          expect(content[1].uuid).to.eql(id2);
        });
      });
    });

    describe('#parseTaskid', () => {
      it('gets the taskid from a prefixed taskid', () => {
        const dc = new MockBoshDirectorClient();
        expect(dc.parseTaskid('123-asd-123-1_123')[1]).to.be.eql('123-asd-123-1');
        expect(dc.parseTaskid('123-asd-123-1_456')[2]).to.be.eql('456');
      });
    });

    describe('#lastSegment', () => {
      it('returns a string', (done) => {
        let content = new MockBoshDirectorClient().lastSegment('https://user:pass@url.com:1000/this/is/a/long/path');
        expect(content).to.be.a('string');
        expect(content).to.equal('path');
        done();
      });
    });

    describe('#determineDirectorAuthenticationMethod', () => {
      it('should set uaaEnabled true when valid config is provided', () => {
        //inject test config in config.directors
        let prevConfigDirectors = config.directors;
        config.directors = [{
          'name': 'bosh',
          'uaa': {
            'client_id': 'client_id',
            'client_secret': 'client_secret',
            'uaa_url': 'uaa_url',
            'uaa_auth': true
          }
        }];
        let mockBoshClient = new MockBoshDirectorClient();
        //clear uaa objects cache
        mockBoshClient.uaaObjects = {};
        mockBoshClient.determineDirectorAuthenticationMethod();
        assert(config.directors[0].uaaEnabled === true);
        config.directors = prevConfigDirectors;
      });

      it('should call shutdown in the event of failure to initialize', () => {
        /* jshint expr:true */
        /* jshint unused:false */
        let prevConfigDirectors = config.directors;
        config.directors = [{
          'name': 'bosh',
          'uaa': {
            'uaa_auth': true
          }
        }];
        let sandbox = sinon.sandbox.create();
        let processExitStub = sandbox.stub(process, 'exit');
        let mock = new MockBoshDirectorClient();
        expect(processExitStub).to.be.calledOnce;
        config.directors = prevConfigDirectors;
        sandbox.restore();
      });
    });

    describe('#populateUAAObjects', () => {
      it('should populate valid UAA objects when valid information is provided in directorConfig', () => {
        let directorConfig = {
          'name': 'bosh',
          'uaa': {
            'client_id': 'client_id',
            'client_secret': 'client_secret',
            'uaa_url': 'uaa_url',
            'uaa_auth': true
          }
        };

        let mockBoshClient = new MockBoshDirectorClient();
        mockBoshClient.populateUAAObjects(directorConfig);

        //assert whether valid objects were popoulatd or not 
        assert(mockBoshClient.uaaObjects[directorConfig.name] !== undefined);
        assert(mockBoshClient.uaaObjects[directorConfig.name].clientId === directorConfig.uaa.client_id);
        assert(mockBoshClient.uaaObjects[directorConfig.name].clientSecret === directorConfig.uaa.client_secret);
        assert(mockBoshClient.uaaObjects[directorConfig.name].uaaClient instanceof UaaClient);
        assert(mockBoshClient.uaaObjects[directorConfig.name].tokenIssuer instanceof TokenIssuer);
      });

      it('should not populate UAA objects when invalid information is provided in directorConfig', () => {
        let directorConfig = {
          'name': 'bosh'
        };

        let mockBoshClient = new MockBoshDirectorClient();
        mockBoshClient.populateUAAObjects(directorConfig);
        assert(mockBoshClient.uaaObjects[directorConfig.name] === undefined);

        //To cover the branch when uaa_url is not provided
        directorConfig = {
          'name': 'bosh',
          'uaa': {
            'client_id': 'client_id',
            'client_secret': 'client_secret',
            'uaa_auth': true
          }
        };

        mockBoshClient.populateUAAObjects(directorConfig);
        assert(mockBoshClient.uaaObjects[directorConfig.name] === undefined);

      });
    });

    describe('#makeRequestWithConfigWithUAA', () => {
      it('should make request with token based auth', (done) => {
        /* jshint expr:true */
        let prevConfigDirectors = config.directors;
        config.directors = [{
          'name': 'bosh',
          'uaa': {
            'client_id': 'client_id',
            'client_secret': 'client_secret',
            'uaa_url': 'uaa_url',
            'uaa_auth': true
          }
        }];

        let directorConfig = {
          'name': 'bosh',
          'url': 'dummy',
          'skip_ssl_validation': true,
          'uaa': {
            'client_id': 'client_id',
            'client_secret': 'client_secret',
            'uaa_auth': true,
            'uaa_url': 'uaa_url'
          },
          'uaaEnabled': true
        };
        let tokenNotExpired = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjM4MzQ4NjQwMDB9';
        //create actual boshDirectorClient
        let dummyBoshDirectorClient = new BoshDirectorClient();
        let sandbox = sinon.sandbox.create();
        let getAccessTokenBoshUAAStub = sandbox.stub(dummyBoshDirectorClient.uaaObjects[directorConfig.name].tokenIssuer, 'getAccessTokenBoshUAA');
        let requestStub = sandbox.stub(HttpClient.prototype, 'request');
        getAccessTokenBoshUAAStub.returns(tokenNotExpired);

        dummyBoshDirectorClient.makeRequestWithConfig({}, 200, directorConfig)
          .then(() => {
            expect(requestStub).to.be.calledOnce;
            sandbox.restore();
            config.directors = prevConfigDirectors;
            done();
          });
      });
    });

    describe('#getDeploymentIpsFromResource', () => {
      it('should return deployment IPs if present in resource', (done) => {
        /* jshint expr:true */
        let dummyResource = {
          name: '4aa31303-127b-4004-b134-e9ffa4a39703',
          metadata: {
            annotations: {
              deploymentIps: JSON.stringify(['10.244.10.216', '10.244.10.217'])
            }
          }
        };
        let sandbox = sinon.sandbox.create();
        let getResourceStub = sandbox.stub(eventmesh.apiServerClient, 'getResource');
        getResourceStub.returns(Promise.resolve(dummyResource));
        let dummyBoshDirectorClient = new MockBoshDirectorClient();
        let deploymentName = 'service-fabrik-0026-4aa31303-127b-4004-b134-e9ffa4a39703';
        dummyBoshDirectorClient.getDeploymentIpsFromResource(deploymentName)
          .then(ips => {
            assert.deepEqual(ips, ['10.244.10.216', '10.244.10.217']);
            expect(getResourceStub).to.be.calledOnce;
            sandbox.restore();
            done();
          });
      });
    });

    describe('#getDeploymentIps', () => {
      it('should return from cache if entry exists', (done) => {
        let dummyBoshDirectorClient = new MockBoshDirectorClient();
        let deploymentName = 'service-fabrik-0026-4aa31303-127b-4004-b134-e9ffa4a39703';
        dummyBoshDirectorClient.deploymentIpsCache[deploymentName] = ['10.244.10.216', '10.244.10.217'];
        let sandbox = sinon.sandbox.create();
        let getDeploymentIpsFromResourceStub = sandbox.stub(dummyBoshDirectorClient, 'getDeploymentIpsFromResource');
        let getDeploymentIpsFromDirectorStub = sandbox.stub(dummyBoshDirectorClient, 'getDeploymentIpsFromDirector');

        dummyBoshDirectorClient.getDeploymentIps(deploymentName)
          .then(ips => {
            assert.deepEqual(ips, ['10.244.10.216', '10.244.10.217']);
            assert(getDeploymentIpsFromResourceStub.notCalled);
            assert(getDeploymentIpsFromDirectorStub.notCalled);
            sandbox.restore();
            done();
          });
      });

      it('should make call to ApiServer if entry doesn\'t exist in cache', (done) => {
        let dummyBoshDirectorClient = new MockBoshDirectorClient();
        let deploymentName = 'service-fabrik-0026-4aa31303-127b-4004-b134-e9ffa4a39703';
        let sandbox = sinon.sandbox.create();
        let getDeploymentIpsFromDirectorStub = sandbox.stub(dummyBoshDirectorClient, 'getDeploymentIpsFromDirector');
        let dummyResource = {
          name: '4aa31303-127b-4004-b134-e9ffa4a39703',
          metadata: {
            annotations: {
              deploymentIps: JSON.stringify(['10.244.10.216', '10.244.10.217'])
            }
          }
        };
        let getResourceStub = sandbox.stub(eventmesh.apiServerClient, 'getResource');
        getResourceStub.returns(Promise.resolve(dummyResource));
        dummyBoshDirectorClient.getDeploymentIps(deploymentName)
          .then(ips => {
            assert.deepEqual(ips, ['10.244.10.216', '10.244.10.217']);
            assert(getDeploymentIpsFromDirectorStub.notCalled);
            assert.deepEqual(dummyBoshDirectorClient.deploymentIpsCache[deploymentName], ips);
            sandbox.restore();
            done();
          });
      });

      it('should make call to director if entry not found in ApiServer', (done) => {
        let dummyBoshDirectorClient = new MockBoshDirectorClient();
        let deploymentName = 'service-fabrik-0026-4aa31303-127b-4004-b134-e9ffa4a39703';
        let sandbox = sinon.sandbox.create();
        let dummyResource = {
          name: '4aa31303-127b-4004-b134-e9ffa4a39703'
        };
        let dummyInstance = [{
          'ips': ['10.244.10.216', '10.244.10.217']
        }];
        let getResourceStub = sandbox.stub(eventmesh.apiServerClient, 'getResource');
        getResourceStub.returns(Promise.resolve(dummyResource));
        let getDeploymentInstancesStub = sandbox.stub(dummyBoshDirectorClient, 'getDeploymentInstances');
        getDeploymentInstancesStub.returns(Promise.resolve(dummyInstance));
        let putDeploymentIpsInResourceStub = sandbox.stub(dummyBoshDirectorClient, 'putDeploymentIpsInResource');
        putDeploymentIpsInResourceStub.returns(Promise.resolve({
          dummy: 'dummy'
        }));
        dummyBoshDirectorClient.getDeploymentIps(deploymentName)
          .then(ips => {
            assert.deepEqual(ips, ['10.244.10.216', '10.244.10.217']);
            assert.deepEqual(dummyBoshDirectorClient.deploymentIpsCache[deploymentName], ips);
            expect(putDeploymentIpsInResourceStub).to.have.been.calledWith(deploymentName, ips);
            sandbox.restore();
            done();
          });
      });
    });
  });
});