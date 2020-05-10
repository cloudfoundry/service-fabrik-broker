'use strict';

const _ = require('lodash');
const nock = require('nock');
const dockerUrl = 'https://192.168.99.100:2376';
const prefix = 'service-fabrik';
const containerId = 'containerid';
const UUID4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const exposedPorts = {
  '8080/tcp': {},
  '9090/tcp': {}
};

const environment = [
  'BLUEPRINT_USER_NAME=user',
  'BLUEPRINT_USER_PASS=secret'
];
const portBindings = {
  '8080/tcp': [{
    HostPort: '52256'
  }],
  '9090/tcp': [{
    HostPort: '41564'
  }]
};

const processes = {
  Titles: [
    'UID', 'PID'
  ],
  Processes: [
    [
      'root', '13642'
    ]
  ]
};

exports.getMissingImages = getMissingImages;
exports.inspectImage = inspectImage;
exports.createContainer = createContainer;
exports.startContainer = startContainer;
exports.deleteContainer = deleteContainer;
exports.inspectContainer = inspectContainer;
exports.getAllContainers = getAllContainers;
exports.deleteVolumes = deleteVolumes;
exports.listContainerProcesses = listContainerProcesses;
exports.getContainerLogs = getContainerLogs;

function getContainerName(guid) {
  return UUID4.test(guid) ? `${prefix}-${guid}` : undefined;
}

function getMissingImages() {
  return nock(dockerUrl)
    .replyContentLength()
    .get(`/images/json`)
    .query({
      all: '1'
    })
    .reply(200, [{
      RepoTags: ['servicefabrikjenkins/blueprint:latest', 'fabianschwarzfritz/mongodb:latest']
    }]);
}

function inspectImage() {
  return nock(dockerUrl)
    .replyContentLength()
    .get(`/images/servicefabrikjenkins/blueprint:latest/json`)
    .reply(200, {
      Config: {
        ExposedPorts: exposedPorts
      }
    });
}

function getAllContainers(ports) {
  const body = _.map(ports, port => ({
    Ports: [{
      Type: 'tcp',
      PublicPort: port
    }]
  }));
  return nock(dockerUrl)
    .get('/containers/json')
    .query({
      all: '1'
    })
    .reply(200, body);
}

function createContainer(guid, times) {
  const name = getContainerName(guid);
  const body = {
    Id: containerId,
    Warnings: null
  };
  return nock(dockerUrl)
    .replyContentLength()
    .post('/containers/create', body => {
      return _.isEqual(body.HostConfig.Binds, [
        `${name}-data-oS100M:/data`
      ]);
    })
    .times(times || 1)
    .query({
      name: name
    })
    .reply(201, body);
}

function startContainer(statusCode) {
  return nock(dockerUrl)
    .post(`/containers/${containerId}/start`)
    .reply(statusCode || 204);
}

function deleteContainer(guid) {
  const name = getContainerName(guid);
  return nock(dockerUrl)
    .delete(`/containers/${name || containerId}`)
    .query({
      v: true,
      force: true
    })
    .reply(204);
}

function inspectContainer(guid, options, status) {
  if (_.isObject(guid)) {
    options = guid;
    guid = undefined;
  }
  const name = getContainerName(guid);
  const body = _.assign({
    Id: containerId,
    Name: name ? `/${name}` : undefined,
    Config: {
      ExposedPorts: exposedPorts,
      Env: environment
    },
    HostConfig: {
      PortBindings: portBindings
    },
    State: {
      Running: true
    },
    NetworkSettings: {
      Ports: {
        '12345/tcp': [{
          HostIp: '0.0.0.0',
          HostPort: 12345
        }]
      }
    }
  }, options);
  return nock(dockerUrl)
    .replyContentLength()
    .get(`/containers/${name || containerId}/json`)
    .reply(status || 200, body);
}

function deleteVolumes(guid) {
  const name = getContainerName(guid);
  return nock(dockerUrl)
    .get('/volumes')
    .query({
      filters: '{"dangling":{"true":true}}'
    })
    .reply(200, {
      Volumes: [{
        Name: 'a-volume-that-should-not-be-removed'
      }, {
        Name: `${name}-0`
      }, {
        Name: `${name}-data-oS100M`
      }]
    })
    .delete(`/volumes/${name}-0`)
    .reply(204)
    .delete(`/volumes/${name}-data-oS100M`)
    .reply(204);
}

function listContainerProcesses() {
  return nock(dockerUrl)
    .get(`/containers/${containerId}/top`)
    .query({
      ps_args: 'aux'
    })
    .reply(200, processes);
}

function getContainerLogs() {
  return nock(dockerUrl)
    .get(`/containers/${containerId}/logs`)
    .query({
      stdout: 1,
      stderr: 1,
      timestamps: 1
    })
    .reply(200, '');
}