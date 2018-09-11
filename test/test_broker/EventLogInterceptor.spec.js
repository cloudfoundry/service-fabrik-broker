'use strict';

const Promise = require('bluebird');
const logger = require('../../common/logger');
const DirectorManager = require('../../broker/lib/fabrik/DirectorManager');
const DockerManager = require('../../broker/lib/fabrik/DockerManager');
const catalog = require('../../common/models/catalog');
const utils = require('../../common/utils');
const config = require('../../common/config');
const path = require('path');
const proxyquire = require('proxyquire');

const pubSubStub = {
  publish: () => undefined
};

const EventLogInterceptor = proxyquire('../../common/EventLogInterceptor', {
  'pubsub-js': {
    /* jshint unused:false */
    publish: function (event, data) {
      return pubSubStub.publish(data);
      /**The above example uses both proxy and stubs.
       * Proxy is used to inject any of the dependencies that we do not want as part of unit test.
       * while we might proxy to be injected, we want to inspect what args went into the proxy method
       * and to do this, we used a stub within the proxy method and invoke the stub method with args
       * that the proxy recieved. We then play it back via the spy and can see the details sent to proxy.
       * NOTE: I followed the above approach, as proxyrequire does not provide this mechanism.
       */
    }
  }
});

describe('EventLogInterceptor', function () {
  /* jshint expr:true */
  const directorManager = new DirectorManager(catalog.getPlan('bc158c9a-7934-401e-94ab-057082a5073f'));
  const dockerManager = new DockerManager(catalog.getPlan('466c5078-df6e-427d-8fb2-c76af50c0f56'));
  const internalAppEventLogInterceptor = EventLogInterceptor.getInstance(config.internal.event_type, 'internal');
  const externalAppEventLogInterceptor = EventLogInterceptor.getInstance(config.external.event_type, 'external');
  let pubSubSpy;

  beforeEach(function () {
    pubSubSpy = sinon.stub(pubSubStub, 'publish');
    pubSubSpy.returns(true);
  });

  afterEach(function () {
    pubSubSpy.restore();
  });

  function buildExpectedRequestArgs(method, url, route, queryParams, pathParams, reqBody, manager, respBody, statusCode) {
    let response = {};
    let request = {};
    request.originalUrl = url;
    request.__route = route;
    request.params = pathParams;
    request.query = queryParams;
    request.method = method;
    request.manager = manager;
    request.ip = '192.168.32.10';
    request.user = {
      name: 'broker'
    };
    request.get = function () {
      return '';
    };
    response.statusCode = statusCode || 200;
    response.body = respBody;
    return [request, response];
  }

  describe('#interceptServiceInstanceCreation', function () {
    it('should log docker service creation status as successful', () => {
      const pathParams = {
        instance_id: '5a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/5a6e7c34-d97c-4fc0-95e6-7a3bc8030b14';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('PUT', url, route, {}, pathParams, {}, dockerManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('5a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${dockerManager.name}.create_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log docker service deletion status as successful', () => {
      const pathParams = {
        instance_id: '5a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/5a6e7c34-d97c-4fc0-95e6-7a3bc8030b14';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('DELETE', url, route, {}, pathParams, {}, dockerManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('5a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${dockerManager.name}.delete_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log director service creation status as in-progress', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('PUT', url, route, {}, pathParams, {}, directorManager, respBody, 202);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.create_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log director service delete status as in-progress', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('DELETE', url, route, {}, pathParams, {}, directorManager, respBody, 202);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.delete_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptServiceInstanceUpdation', function () {
    it('should log director service instance update status as in progress', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('PATCH', url, route, {}, pathParams, {}, directorManager, respBody, 202);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.update_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptServiceStateInfo', function () {
    it('should log state of a service instance returned successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const query = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f'
      };
      const url = '/api/v1/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14';
      const route = '/api/v1/service_instances/:instance_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, {}, directorManager, respBody, 200);
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          expect(testResult.request.plan_id).to.eql('bc158c9a-7934-401e-94ab-057082a5073f');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.service_instance_info`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptServiceBindings', function () {
    it('should log creation of service instance bind as successful', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15',
        binding_id: '082da7c8-c557-4b3d-b698-3b0a9a3ca947'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/service_bindings/082da7c8-c557-4b3d-b698-3b0a9a3ca947';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/service_bindings/:binding_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('PUT', url, route, {}, pathParams, {}, directorManager, respBody, 201);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          expect(testResult.request.binding_id).to.eql('082da7c8-c557-4b3d-b698-3b0a9a3ca947');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.create_binding`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log unbind of service instance as successful', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15',
        binding_id: '082da7c8-c557-4b3d-b698-3b0a9a3ca947'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/service_bindings/082da7c8-c557-4b3d-b698-3b0a9a3ca947';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/service_bindings/:binding_id';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('DELETE', url, route, {}, pathParams, {}, directorManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          expect(testResult.request.binding_id).to.eql('082da7c8-c557-4b3d-b698-3b0a9a3ca947');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.delete_binding`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptBackup', function () {
    it('should log service instance backup initiated successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/api/v1/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/backup';
      const route = '/api/v1/service_instances/:instance_id/backup';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('POST', url, route, {}, pathParams, {}, directorManager, respBody, 202);
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.create_backup`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log metadata of the last backup operation on BOSH instance returned successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/api/v1/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/backup';
      const route = '/api/v1/service_instances/:instance_id/backup';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, {}, pathParams, {}, directorManager, respBody, 200);
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.instance_backup_info`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log service instance backup abort initiated successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/api/v1/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/backup';
      const route = '/api/v1/service_instances/:instance_id/backup';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('DELETE', url, route, {}, pathParams, {}, directorManager, respBody, 202);
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.abort_backup`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log metadata of last backup operation for all service instances within the given space returned successfully', () => {
      const pathParams = {
        operation: 'backup'
      };
      const query = {
        space_guid: 'b0194fc0-3906-496c-8618-b1772c488ac'
      };
      const url = '/api/v1/service_instances/backup';
      const route = '/api/v1/service_instances/:operation(backup|restore)';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, {}, directorManager, respBody, 200);
      request.user = {
        'name': 'admin'
      };
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.space_guid).to.eql('b0194fc0-3906-496c-8618-b1772c488ac');
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.list_last_backups`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log metadata of all backups within the given space returned successfully', () => {
      const pathParams = {};
      const query = {
        space_guid: 'b0194fc0-3906-496c-8618-b1772c488ac'
      };
      const url = '/api/v1/backups';
      const route = '/api/v1/backups';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, {}, directorManager, respBody, 200);
      request.user = {
        'name': 'admin'
      };
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.space_guid).to.eql('b0194fc0-3906-496c-8618-b1772c488ac');
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.list_all_backups`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log metadata of a specific backup returned successfully', () => {
      const pathParams = {
        backup_guid: 'f7a9cc40-b5ca-4a72-a093-9dbce9778e9b'
      };
      const query = {
        space_guid: 'b0194fc0-3906-496c-8618-b1772c488ac'
      };
      const url = '/api/v1/backups/f7a9cc40-b5ca-4a72-a093-9dbce9778e9b';
      const route = '/api/v1/backups/:backup_guid';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, {}, directorManager, respBody, 200);
      request.user = {
        'name': 'admin'
      };
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.EVENT_LOG_CONFIG['/api/v1/backups/:backup_guid'].GET.enabled = true;
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.space_guid).to.eql('b0194fc0-3906-496c-8618-b1772c488ac');
          expect(testResult.request.backup_guid).to.eql('f7a9cc40-b5ca-4a72-a093-9dbce9778e9b');
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.get_backup_by_guid`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log backup with input backup guid successfully deleted', () => {
      const pathParams = {
        backup_guid: 'f7a9cc40-b5ca-4a72-a093-9dbce9778e9b'
      };
      const query = {
        space_guid: 'b0194fc0-3906-496c-8618-b1772c488ac'
      };
      const url = '/api/v1/backups/f7a9cc40-b5ca-4a72-a093-9dbce9778e9b';
      const route = '/api/v1/backups/:backup_guid';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('DELETE', url, route, query, pathParams, {}, directorManager, respBody, 200);
      request.user = {
        'name': 'admin'
      };
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.space_guid).to.eql('b0194fc0-3906-496c-8618-b1772c488ac');
          expect(testResult.request.backup_guid).to.eql('f7a9cc40-b5ca-4a72-a093-9dbce9778e9b');
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.delete_backup_by_guid`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptRestore', function () {
    it('should log service instance restore initiated successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/api/v1/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/restore';
      const route = '/api/v1/service_instances/:instance_id/restore';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('POST', url, route, {}, pathParams, {}, directorManager, respBody, 202);
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.restore_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log restore metadata for service instance returned successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/api/v1/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/restore';
      const route = '/api/v1/service_instances/:instance_id/restore';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, {}, pathParams, {}, directorManager, respBody, 200);
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.instance_restore_info`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log service instance restore abort initiated successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/api/v1/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b14/restore';
      const route = '/api/v1/service_instances/:instance_id/restore';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('DELETE', url, route, {}, pathParams, {}, directorManager, respBody, 202);
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.abort_restore`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log metadata of last restore operation for all service instances within the given space returned successfully', () => {
      const pathParams = {
        operation: 'restore'
      };
      const query = {
        space_guid: 'b0194fc0-3906-496c-8618-b1772c488ac'
      };
      const url = '/api/v1/service_instances/restore';
      const route = '/api/v1/service_instances/:operation(backup|restore)';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, {}, directorManager, respBody, 200);
      request.user = {
        'name': 'admin'
      };
      return Promise
        .try(() => {
          externalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.space_guid).to.eql('b0194fc0-3906-496c-8618-b1772c488ac');
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.list_last_restore`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptGetLastOperation', function () {
    it('should log the director service instance creation status as successful', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const timestamp = new Date();
      const respBody = {
        state: 'succeeded',
        description: `create deployment 234 succeeded at ${timestamp}`
      };
      const op = {
        type: 'create'
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.create_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log the director service instance update status as successful', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const timestamp = new Date();
      const respBody = {
        state: 'succeeded',
        description: `update deployment 244 succeeded at ${timestamp}`
      };
      const op = {
        type: 'update'
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.update_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log the director service instance create status as failed', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const timestamp = new Date();
      const respBody = {
        state: 'failed',
        description: `create deployment 254 failed at ${timestamp}`
      };
      const op = {
        type: 'create'
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 500);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.failure_state);
          expect(testResult.metric).to.eql(config.monitoring.failure_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.create_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log the director service instance update status as failed', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const timestamp = new Date();
      const respBody = {
        state: 'failed',
        description: `update deployment 244 failed at ${timestamp}`
      };
      const op = {
        type: 'update'
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 500);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.failure_state);
          expect(testResult.metric).to.eql(config.monitoring.failure_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.update_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log the director service instance deletion status as successful', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const timestamp = new Date();
      const respBody = {
        state: 'succeeded',
        description: `Delete deployment 245 succeeded at ${timestamp}`
      };
      const op = {
        type: 'delete'
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.delete_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log the director service instance deletion status as successful(410)', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const timestamp = new Date();
      const respBody = {};
      const op = {
        type: 'delete'
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 410);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.delete_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log the director service instance deletion status as failed', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const timestamp = new Date();
      const respBody = {
        state: 'failed',
        description: `Delete deployment 245 failed at ${timestamp}`
      };
      const op = {
        type: 'delete'
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.failure_state);
          expect(testResult.metric).to.eql(config.monitoring.failure_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.delete_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log service instance backup completed successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const op = {
        type: 'update',
        subtype: 'backup',
        deployment: 'service-fabrik-118-4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15',
        parameters: {}
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const timestamp = new Date();
      const respBody = {
        state: 'succeeded',
        description: `backup deployment ${op.deployment} succeeded at ${timestamp}`
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.create_backup`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log service instance backup failed', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const op = {
        type: 'update',
        subtype: 'backup',
        deployment: 'service-fabrik-118-4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15',
        parameters: {}
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const timestamp = new Date();
      const respBody = {
        state: 'failed',
        description: `backup deployment ${op.deployment} failed at ${timestamp} with Error`
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 500);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.failure_state);
          expect(testResult.metric).to.eql(config.monitoring.failure_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.create_backup`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log service instance restore completed successfully', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const op = {
        type: 'update',
        subtype: 'restore',
        deployment: 'service-fabrik-118-4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15',
        parameters: {}
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const timestamp = new Date();
      const respBody = {
        state: 'succeeded',
        description: `restore deployment ${op.deployment} succeeded at ${timestamp}`
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 200);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.restore_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log service instance restore failed', () => {
      const pathParams = {
        instance_id: '4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15'
      };
      const url = '/cf/v2/service_instances/4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15/last_operation';
      const route = '/:platform(cf|k8s)/v2/service_instances/:instance_id/last_operation';
      const op = {
        type: 'update',
        subtype: 'restore',
        deployment: 'service-fabrik-118-4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15',
        parameters: {}
      };
      const query = {
        operation: utils.encodeBase64(op)
      };
      const timestamp = new Date();
      const respBody = {
        state: 'failed',
        description: `restore deployment ${op.deployment} failed at ${timestamp} with Error`
      };
      const reqBody = {
        plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
        service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4'
      };
      const [request, response] = buildExpectedRequestArgs('GET', url, route, query, pathParams, reqBody, directorManager, respBody, 500);
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.failure_state);
          expect(testResult.metric).to.eql(config.monitoring.failure_metric);
          expect(testResult.request.instance_id).to.eql('4a6e7c34-d97c-4fc0-95e6-7a3bc8030b15');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.${directorManager.name}.restore_instance`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptAdminOperations', function () {
    it('should log all director deployments returned successfully', () => {
      const pathParams = {};
      const url = '/admin/deployments';
      const route = '/admin/deployments';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, {}, pathParams, {}, undefined, respBody, 200);
      request.user = {
        name: 'admin'
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.get_all_deployments`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log retrieved deployment by name successfully', () => {
      const pathParams = {
        name: 'service-fabrik-broker-0021-4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9'
      };
      const url = '/admin/deployments/service-fabrik-broker-0021-4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9';
      const route = '/admin/deployments/:name';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, {}, pathParams, {}, undefined, respBody, 200);
      request.user = {
        name: 'admin'
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.name).to.eql('service-fabrik-broker-0021-4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.get_deployment_by_name`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log deployment update initiated successfully', () => {
      const pathParams = {
        name: 'service-fabrik-broker-0021-4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9'
      };
      const url = '/admin/deployments/service-fabrik-broker-0021-4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9/update';
      const route = '/admin/deployments/:name/update';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('POST', url, route, {}, pathParams, {}, undefined, respBody, 200);
      request.user = {
        name: 'admin'
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.name).to.eql('service-fabrik-broker-0021-4a6e7c34-d97c-4fc0-95e6-7a3bc8030be9');
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.initiate_update_deployment`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log all outdated deployments returned successfully', () => {
      const pathParams = {};
      const url = '/admin/deployments/outdated';
      const route = '/admin/deployments/outdated';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, {}, pathParams, {}, undefined, respBody, 200);
      request.user = {
        name: 'admin'
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.get_outdated_deployments`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log update of all outdated deployments initiated successfully', () => {
      const pathParams = {};
      const url = '/admin/deployments/outdated/update';
      const route = '/admin/deployments/outdated/update';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('POST', url, route, {}, pathParams, {}, undefined, respBody, 202);
      request.user = {
        name: 'admin'
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.inprogress_state);
          expect(testResult.metric).to.eql(config.monitoring.inprogress_metric);
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.update_all_outdated_deployments`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log all backups returned successfully', () => {
      const pathParams = {};
      const url = '/admin/backups';
      const route = '/admin/backups';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, {}, pathParams, {}, undefined, respBody, 200);
      request.user = {
        name: 'admin'
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.user.name).to.eql('admin');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.list_all_backup`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });

    it('should log deletion of input backup guid completed successfully', () => {
      const pathParams = {
        backup_guid: 'f7a9cc40-b5ca-4a72-a093-9dbce9778e9b'
      };
      const url = '/admin/backups/f7a9cc40-b5ca-4a72-a093-9dbce9778e9b/delete';
      const route = '/admin/backups/:backup_guid/delete';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('POST', url, route, {}, pathParams, {}, undefined, respBody, 200);
      request.user = {
        name: 'admin'
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.success_state);
          expect(testResult.metric).to.eql(config.monitoring.success_metric);
          expect(testResult.request.user.name).to.eql('admin');
          expect(testResult.request.backup_guid).to.eql('f7a9cc40-b5ca-4a72-a093-9dbce9778e9b');
          const expectedEvtName = `${config.monitoring.event_name_prefix}.delete_backup`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });

  describe('#interceptUnauthorizedRequests', function () {
    it('should log unauthorized user access to service broker APIs', () => {
      const pathParams = {};
      const url = '/admin/deployments';
      const route = '/admin/deployments';
      const respBody = {};
      const [request, response] = buildExpectedRequestArgs('GET', url, route, {}, pathParams, {}, undefined, respBody, 401);
      request.user = {
        name: ''
      };
      response.getHeader = function () {
        return 'Basic realm="Secure Area"';
      };
      return Promise
        .try(() => {
          internalAppEventLogInterceptor.execute(request, response, respBody);
        })
        .then(() => {
          expect(pubSubSpy).to.be.called;
          const testResponse = pubSubSpy.firstCall.args[0];
          expect(testResponse).to.be.an('object');
          const testResult = testResponse.event;
          expect(testResult.state).to.eql(config.monitoring.failure_state);
          expect(testResult.metric).to.eql(config.monitoring.failure_metric);
          expect(testResult.request.ip).to.eql(request.ip);
          const expectedEvtName = `${config.monitoring.event_name_prefix}.unauthorized_access`;
          expect(testResult.eventName).to.eql(expectedEvtName);
        });
    });
  });
});