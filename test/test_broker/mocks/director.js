'use strict';

const _ = require('lodash');
const nock = require('nock');
const yaml = require('js-yaml');
const parseUrl = require('url').parse;
const lib = require('../../../broker/lib');
const CONST = require('../../../broker/lib/constants');
const agent = require('./agent');
const config = lib.config;
const bosh = require('../../../data-access-layer/bosh');
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const prefix = 'service-fabrik';
const networkSegmentIndex = 21;
const credentials = agent.credentials;
const activePrimaryConfig = _.sample(_
  .filter(config.directors, function (director) {
    return director.support_create && director.primary;
  }));
const directorUrl = activePrimaryConfig.url;

const manifest = {
  name: 'test-deployment-name',
  instance_groups: [{
    name: 'blueprint',
    networks: [{
      name: 'default',
      static_ips: [parseUrl(agent.url).hostname]
    }],
    jobs: [{
        name: 'blueprint',
        properties: {
          admin: {
            username: 'admin',
            password: 'admin'
          },
          mongodb: {
            service_agent: {
              username: 'admin',
              password: 'admin'
            }
          }
        }
      },
      {
        name: 'broker-agent',
        properties: {
          username: 'admin',
          password: 'admin',
          provider: {
            name: 'openstack',
            container: config.backup.provider.container
          }
        }
      }
    ]
  }],
};

exports.url = directorUrl;
exports.networkSegmentIndex = networkSegmentIndex;
exports.uuidByIndex = uuidByIndex;
exports.deploymentNameByIndex = deploymentNameByIndex;
exports.getLockProperty = getLockProperty;
exports.getDeployment = getDeployment;
exports.getDeployments = getDeployments;
exports.getDeploymentNames = getDeploymentNames;
exports.createOrUpdateDeployment = createOrUpdateDeployment;
exports.createOrUpdateDeploymentOp = createOrUpdateDeploymentOp;
exports.getCurrentTasks = getCurrentTasks;
exports.deleteDeployment = deleteDeployment;
exports.getDeploymentTask = getDeploymentTask;
exports.getDeploymentManifest = getDeploymentManifest;
exports.diffDeploymentManifest = diffDeploymentManifest;
exports.getBindingProperty = getBindingProperty;
exports.createBindingProperty = createBindingProperty;
exports.updateBindingProperty = updateBindingProperty;
exports.deleteBindingProperty = deleteBindingProperty;
exports.createDeploymentProperty = createDeploymentProperty;
exports.getDeploymentProperty = getDeploymentProperty;
exports.bindDeployment = bindDeployment;
exports.unbindDeployment = unbindDeployment;
exports.getDeploymentVms = getDeploymentVms;
exports.verifyDeploymentLockStatus = verifyDeploymentLockStatus;
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.manifest = manifest;
exports.getDeploymentInstances = getDeploymentInstances;

function uuidByIndex(index) {
  const buffer = new Buffer(1);
  buffer.writeUInt8(index);
  return `b4719e7c-e8d3-4f7f-c5${buffer.toString('hex')}-769ad1c3ebfa`;
}

function deploymentNameByIndex(index) {
  return `${prefix}-${_.padStart(index, 4, '0')}-${uuidByIndex(index)}`;
}

function getDeploymentNames(capacity, queued, oob) {
  let names = _
    .chain(queued ? 3 : 0)
    .range(capacity)
    .pull(queued ? networkSegmentIndex : -1)
    .map(index => ({
      name: deploymentNameByIndex(index)
    }))
    .value();

  if (oob) {
    names = _.concat(names, [{
        name: 'ccdb'
      },
      {
        name: CONST.FABRIK_INTERNAL_MONGO_DB.INSTANCE_ID
      },
      {
        name: 'service-fabrik-mongodb'
      }
    ]);
  }
  return names;
}

function getDeployments(opts, expectedReturnStatusCode) {
  const queued = _.get(opts, 'queued', false);
  const capacity = _.get(opts, 'capacity', NetworkSegmentIndex.capacity());
  const noOfTimes = 1;
  const oob = _.get(opts, 'oob', true);
  const deployments = getDeploymentNames(capacity, queued, oob);
  const scope = _
    .range(noOfTimes)
    .map(() => nock(directorUrl)
      .replyContentLength()
      .get('/deployments')
      .reply(expectedReturnStatusCode || 200, deployments));
  if (queued) {
    const tasks = _
      .chain()
      .range(3)
      .map(index => ({
        deployment: deploymentNameByIndex(index)
      }))
      .value();
    _
      .range(noOfTimes)
      .map(index => scope[index]
        .get('/tasks')
        .query({
          limit: 1000,
          state: 'queued'
        })
        .reply(200, tasks)
      );
  }
  return scope;
}

function createOrUpdateDeployment(taskId) {
  return nock(directorUrl, {
      reqheaders: {
        'Content-Type': 'text/yaml'
      }
    })
    .post('/deployments')
    .reply(302, null, {
      'location': `${directorUrl}/tasks/${taskId}`
    });
}

function getCurrentTasks(taskResponse) {
  return nock(directorUrl)
    .replyContentLength()
    .get(`/tasks`)
    .query(() => true)
    .reply(200, taskResponse);
}

function createOrUpdateDeploymentOp(taskId, operation) {
  let boshContextId = 'Fabrik::Operation::Auto';
  if (operation) {
    boshContextId = `Fabrik::Operation::${operation}`;
  }
  return nock(directorUrl, {
      reqheaders: {
        'Content-Type': 'text/yaml',
        'X-Bosh-Context-Id': boshContextId
      }
    })
    .post('/deployments')
    .reply(302, null, {
      'location': `${directorUrl}/tasks/${taskId}`
    });
}

function deleteDeployment(taskId) {
  return nock(directorUrl)
    .delete(`/deployments/${deploymentNameByIndex(networkSegmentIndex)}`)
    .reply(302, null, {
      'location': `${directorUrl}/tasks/${taskId}`
    });
}

function getDeploymentTask(taskId, state, notFound) {
  if (notFound) {
    return nock(directorUrl)
      .replyContentLength()
      .get(`/tasks/${taskId}`)
      .reply(404, {});
  }
  return nock(directorUrl)
    .replyContentLength()
    .get(`/tasks/${taskId}`)
    .reply(200, {
      id: taskId,
      state: state,
      description: 'create deployment',
      timestamp: 1467629904,
      result: 'result',
      deployment: deploymentNameByIndex(networkSegmentIndex)
    });
}

function getLockProperty(deploymentName, found, lockInfo) {
  if (!found) {
    return nock(directorUrl)
      .replyContentLength()
      .get(`/deployments/${deploymentName}/properties/${CONST.DEPLOYMENT_LOCK_NAME}`)
      .reply(404, {});
  }
  return nock(directorUrl)
    .replyContentLength()
    .get(`/deployments/${deploymentName}/properties/${CONST.DEPLOYMENT_LOCK_NAME}`)
    .reply(200, {
      value: JSON.stringify(lockInfo || {
        username: 'admin',
        lockedForOperation: 'backup',
        createdAt: new Date()
      })
    });
}

function getDeployment(deploymentName, found, boshDirectorUrlInput, attempts) {
  const boshDirectorUrl = boshDirectorUrlInput || directorUrl;
  if (!found) {
    return nock(boshDirectorUrl)
      .replyContentLength()
      .get(`/deployments/${deploymentName}`)
      .times(attempts || 1)
      .reply(404, {
        'code': 70000,
        'description': `'Deployment ${deploymentName} doesn\'t exist'`
      });
  }
  return nock(boshDirectorUrl)
    .replyContentLength()
    .get(`/deployments/${deploymentName}`)
    .times(attempts || 1)
    .reply(200, {
      manifest: yaml.dump(manifest)
    });
}

function getDeploymentManifest(times, boshDirectorUrlInput) {
  const boshDirectorUrl = boshDirectorUrlInput || directorUrl;
  return nock(boshDirectorUrl)
    .replyContentLength()
    .get(/\/deployments\/([a-zA-Z0-9\-]+)$/)
    .times(times || 1)
    .reply(200, {
      manifest: yaml.dump(manifest)
    });
}

function diffDeploymentManifest(times, diff) {
  return nock(directorUrl, {
      reqheaders: {
        'Content-Type': 'text/yaml'
      }
    })
    .replyContentLength()
    .post(/\/deployments\/([a-zA-Z0-9\-]+)\/diff$/)
    .query({
      redact: false
    })
    .times(times || 1)
    .reply(200, {
      diff: diff || [
        ['releases:', null],
        ['- name: blueprint', null],
        ['  version: 0.0.10', 'removed'],
        ['  version: 0.0.11', 'added']
      ]
    });
}

function createBindingProperty(binding_id, parameters, deployment, binding_credentials) {
  const deploymentName = deployment || deploymentNameByIndex(networkSegmentIndex);

  return nock(directorUrl)
    .post(`/deployments/${deploymentName}/properties`, body => {
      return body.name === `binding-${binding_id}` &&
        _.isEqual(JSON.parse(body.value), {
          id: binding_id,
          credentials: binding_credentials || credentials,
          parameters: parameters || {}
        });
    })
    .reply(204);
}

function createDeploymentProperty(name, value, deployment) {
  const deploymentName = deployment || deploymentNameByIndex(networkSegmentIndex);

  return nock(directorUrl)
    .post(`/deployments/${deploymentName}/properties`, body => {
      return body.name === name &&
        _.isEqual(JSON.parse(body.value), value);
    })
    .reply(204);
}

function getDeploymentProperty(deploymentName, found, key, value) {
  if (!found) {
    return nock(directorUrl)
      .replyContentLength()
      .get(`/deployments/${deploymentName}/properties/${key}`)
      .reply(404, {});
  }
  return nock(directorUrl)
    .replyContentLength()
    .get(`/deployments/${deploymentName}/properties/${key}`)
    .reply(200,
      JSON.stringify({
        value: JSON.stringify(value)
      } || {})
    );
}

function updateBindingProperty(binding_id, parameters, binding_credentials) {
  return nock(directorUrl)
    .put(`/deployments/${deploymentNameByIndex(networkSegmentIndex)}/properties/binding-${binding_id}`, body => {
      return _.isEqual(JSON.parse(body.value), {
        id: binding_id,
        credentials: binding_credentials || credentials,
        parameters: parameters || {}
      });
    })
    .reply(204);
}

function deleteBindingProperty(binding_id) {
  return nock(directorUrl)
    .delete(`/deployments/${deploymentNameByIndex(networkSegmentIndex)}/properties/binding-${binding_id}`)
    .reply(204);
}

function getBindingProperty(binding_id, parameters, deployment, notFound, binding_credentials) {
  const deploymentName = deployment || deploymentNameByIndex(networkSegmentIndex);
  if (notFound) {
    return nock(directorUrl)
      .replyContentLength()
      .get(`/deployments/${deploymentName}/properties/binding-${binding_id}`)
      .reply(404, {});
  }
  return nock(directorUrl)
    .replyContentLength()
    .get(`/deployments/${deploymentName}/properties/binding-${binding_id}`)
    .reply(200, {
      value: JSON.stringify({
        id: binding_id,
        credentials: binding_credentials || credentials,
        parameters: parameters || {}
      })
    });
}

function verifyDeploymentLockStatus(deployment, locked, params) {
  const deploymentName = deployment || deploymentNameByIndex(networkSegmentIndex);
  if (!locked) {
    return nock(directorUrl)
      .replyContentLength()
      .get(`/deployments/${deploymentName}/properties/${CONST.DEPLOYMENT_LOCK_NAME}`)
      .reply(404, {});
  }
  params = params ? params : {};
  return nock(directorUrl)
    .replyContentLength()
    .get(`/deployments/${deploymentName}/properties/${CONST.DEPLOYMENT_LOCK_NAME}`)
    .reply(200, {
      value: JSON.stringify({
        username: 'admin',
        lockedForOperation: params.lockedForOperation || 'backup',
        createdAt: new Date()
      })
    });
}

function releaseLock(deployment, expectedStatusCode) {
  const deploymentName = deployment || deploymentNameByIndex(networkSegmentIndex);
  return nock(directorUrl)
    .delete(`/deployments/${deploymentName}/properties/${CONST.DEPLOYMENT_LOCK_NAME}`)
    .reply(expectedStatusCode || 204);
}

function acquireLock(deployment) {
  const deploymentName = deployment || deploymentNameByIndex(networkSegmentIndex);
  return nock(directorUrl)
    .put(`/deployments/${deploymentName}/properties/${CONST.DEPLOYMENT_LOCK_NAME}`)
    .reply(204);
}

function bindDeployment(guid, binding_id) {
  const deploymentName = `${prefix}-0000-${guid}`;

  nock(directorUrl)
    .replyContentLength()
    .get('/deployments')
    .reply(200, [{
      name: `${prefix}-0000-${guid}`
    }])
    .replyContentLength()
    .get(`/deployments/${deploymentName}/properties/binding-${binding_id}`)
    .reply(404)
    .replyContentLength()
    .post(`/deployments/${deploymentName}/properties`)
    .reply(204)
    .replyContentLength()
    .get(`/deployments/${deploymentName}`)
    .reply(200, {
      manifest: yaml.dump(manifest)
    }, {
      'Content-Type': 'text/yaml'
    });
}

function unbindDeployment(guid, binding_id) {
  const deploymentName = `${prefix}-0000-${guid}`;
  nock(directorUrl)
    .replyContentLength()
    .get('/deployments')
    .reply(200, [{
      name: `${prefix}-0000-${guid}`
    }])
    .replyContentLength()
    .get(`/deployments/${deploymentName}/properties/binding-${binding_id}`)
    .reply(200, {
      value: '{"credentials": {"hostname": "1234"}}'
    })
    .replyContentLength()
    .get(`/deployments/${deploymentName}`)
    .reply(200, {
      manifest: yaml.dump(manifest)
    }, {
      'Content-Type': 'text/yaml'
    })
    .replyContentLength()
    .delete(`/deployments/${deploymentName}/properties/binding-${binding_id}`)
    .reply(204);
}

function getDeploymentVms(deploymentName, times, vms, boshDirectorUrlInput, found) {
  const boshDirectorUrl = boshDirectorUrlInput || directorUrl;
  if (found === false) {
    return nock(boshDirectorUrl)
      .get(`/deployments/${deploymentName}/vms`)
      .times(times || 1)
      .reply(404, {
        'code': 70000,
        'description': `'Deployment ${deploymentName} doesn\'t exist'`
      });
  } else {
    return nock(boshDirectorUrl)
      .get(`/deployments/${deploymentName}/vms`)
      .times(times || 1)
      .reply(200, vms || [{
        cid: '081e3263-e066-4a5a-868f-b420c72a260d',
        job: 'blueprint_z1',
        ips: [parseUrl(agent.url).hostname],
        index: 0
      }]);
  }
}

function getDeploymentInstances(deploymentName, times, vms, boshDirectorUrlInput, found) {
  const boshDirectorUrl = boshDirectorUrlInput || directorUrl;
  if (found === false) {
    return nock(boshDirectorUrl)
      .get(`/deployments/${deploymentName}/instances`)
      .times(times || 1)
      .reply(404, {
        'code': 70000,
        'description': `'Deployment ${deploymentName} doesn\'t exist'`
      });
  } else {
    return nock(boshDirectorUrl)
      .get(`/deployments/${deploymentName}/instances`)
      .times(times || 1)
      .reply(200, vms || [{
        cid: '081e3263-e066-4a5a-868f-b420c72a260d',
        job: 'blueprint_z1',
        ips: [parseUrl(agent.url).hostname],
        index: 0
      }]);
  }
}