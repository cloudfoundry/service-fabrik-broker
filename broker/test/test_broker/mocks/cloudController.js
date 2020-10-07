'use strict';

const _ = require('lodash');
const nock = require('nock');
const config = require('@sf/app-config');
const cloudControllerUrl = config.cf.url;
const prefix = 'service-fabrik';
const DirectorService = require('@sf/provisioner-services').DirectorService;

exports.url = cloudControllerUrl;
exports.getInfo = getInfo;
exports.createSecurityGroup = createSecurityGroup;
exports.findSecurityGroupByName = findSecurityGroupByName;
exports.deleteSecurityGroup = deleteSecurityGroup;
exports.getServiceInstancePermissions = getServiceInstancePermissions;
exports.getServiceInstance = getServiceInstance;
exports.getServiceInstances = getServiceInstances;
exports.getServiceInstancesInSpaceWithName = getServiceInstancesInSpaceWithName;
exports.updateServiceInstance = updateServiceInstance;
exports.findServiceBrokerByName = findServiceBrokerByName;
exports.getServicePlans = getServicePlans;
exports.getServicePlan = getServicePlan;
exports.getSpace = getSpace;
exports.getSpaces = getSpaces;
exports.getOrganizations = getOrganizations;
exports.getOrganization = getOrganization;
exports.getPlans = getPlans;
exports.findServicePlan = findServicePlan;
exports.getSpaceDevelopers = getSpaceDevelopers;
exports.findServicePlanByInstanceId = findServicePlanByInstanceId;

function getInfo(options) {
  return nock(cloudControllerUrl)
    .replyContentLength()
    .get('/v2/info')
    .reply(200, _.assign({
      api_version: '2.55.0'
    }, options));
}

function getSecurityGroupName(guid) {
  return `${prefix}-${guid}`;
}

function createSecurityGroup(guid, responseCode, times) {
  const name = getSecurityGroupName(guid);
  return nock(cloudControllerUrl)
    .replyContentLength()
    .post('/v2/security_groups', body => body.name === name)
    .times(times || 1)
    .reply(responseCode || 201, {
      metadata: {
        guid: guid
      },
      entity: {
        name: name
      }
    });
}

function findSecurityGroupByName(guid, resources) {
  const name = getSecurityGroupName(guid);
  const defaults = [{
    metadata: {
      guid: guid
    },
    entity: {
      name: name
    }
  }];
  resources = resources || defaults;
  return nock(cloudControllerUrl)
    .replyContentLength()
    .get('/v2/security_groups')
    .query({
      q: `name:${name}`
    })
    .reply(200, {
      resources: resources
    });
}

function deleteSecurityGroup(guid) {
  return nock(cloudControllerUrl)
    .delete(`/v2/security_groups/${guid}`)
    .query({
      async: false
    })
    .reply(204);
}

function getServiceInstancePermissions(guid) {
  return nock(cloudControllerUrl)
    .get(`/v2/service_instances/${guid}/permissions`)
    .reply(200, {
      manage: true
    });
}

function updateServiceInstance(guid, verifier, responseCode, responseBody) {
  return nock(cloudControllerUrl)
    .put(`/v2/service_instances/${guid}`, verifier)
    .query({
      accepts_incomplete: true
    })
    .reply(responseCode || 202, responseBody || {
      metadata: {
        guid: guid
      },
      entity: {}
    });
}

function getServiceInstance(guid, entity, times) {
  return nock(cloudControllerUrl)
    .get(`/v2/service_instances/${guid}`)
    .times(times || 1)
    .reply(200, {
      metadata: {
        guid: guid
      },
      entity: _.assign({
        name: 'blueprint',
        service_plan_guid: '466c5078-df6e-427d-8fb2-c76af50c0f56'
      }, entity)
    });
}

function getSpace(guid, entity, times) {
  return nock(cloudControllerUrl)
    .get(`/v2/spaces/${guid}`)
    .times(times || 1)
    .reply(200, {
      metadata: {
        guid: guid
      },
      entity: _.assign({
        name: 'blueprint'
      }, entity)
    });
}

function findServiceBrokerByName(broker_guid, broker_name) {
  return nock(cloudControllerUrl)
    .get('/v2/service_brokers')
    .query({
      q: `name:${broker_name}`
    })
    .reply(200, {
      resources: [{
        metadata: {
          guid: broker_guid
        },
        entity: {
          name: broker_name
        }
      }]
    });
}

function getServicePlans(broker_guid, plan_guid, plan_unique_id) {
  return nock(cloudControllerUrl)
    .get('/v2/service_plans')
    .query({
      q: `service_broker_guid:${broker_guid}`
    })
    .reply(200, {
      resources: [{
        metadata: {
          guid: plan_guid
        },
        entity: {
          unique_id: plan_unique_id
        }
      }]
    });
}

function getSpaces(space_guid) {
  return nock(cloudControllerUrl)
    .get('/v2/spaces')
    .reply(200, {
      resources: [{
        metadata: {
          guid: space_guid
        },
        entity: {}
      }]
    });
}

function getOrganizations(org_guid) {
  return nock(cloudControllerUrl)
    .get('/v2/organizations')
    .reply(200, {
      resources: [{
        metadata: {
          guid: org_guid
        },
        entity: {}
      }]
    });
}

function getOrganization(guid, entity, times) {
  return nock(cloudControllerUrl)
    .get(`/v2/organizations/${guid}`)
    .times(times || 1)
    .reply(200, {
      metadata: {
        guid: guid
      },
      entity: _.assign({
        name: 'blueprint'
      }, entity)
    });
}

function getPlans(broker_guid, plan_guid, plan_unique_id) {
  return nock(cloudControllerUrl)
    .get('/v2/service_plans')
    .query({
      q: `service_broker_guid:${broker_guid}`
    })
    .reply(200, {
      resources: [{
        metadata: {
          guid: plan_guid
        },
        entity: {
          unique_id: plan_unique_id
        }
      }]
    });
}

function getServicePlan(plan_guid, plan_unique_id, entity) {
  return nock(cloudControllerUrl)
    .get(`/v2/service_plans/${plan_guid}`)
    .reply(200, {
      entity: _.assign({
        unique_id: plan_unique_id,
        name: 'blueprint'
      }, entity)
    });
}

function findServicePlan(instance_id, plan_unique_id, times) {
  const entity = plan_unique_id ? {
    entity: {
      unique_id: plan_unique_id
    }
  } : '';
  return nock(cloudControllerUrl)
    .get('/v2/service_plans')
    .times(times || 1)
    .query({
      q: `service_instance_guid:${instance_id}`
    })
    .reply(200, {
      resources: [entity]
    });
}

function getServiceInstances(plan_guid, size, space_guid, org_guid) {
  const instances = _
    .chain(mocks.director.getDeploymentNames(size))
    .map(deployment => ({
      metadata: {
        guid: _.nth(DirectorService.parseDeploymentName(deployment.name), 2)
      },
      entity: {
        service_plan_guid: plan_guid,
        space_guid: space_guid
      },
      space: {
        organization_guid: org_guid
      }
    }))
    .value();
  return nock(cloudControllerUrl)
    .get('/v2/service_instances')
    .query({
      q: `service_plan_guid IN ${plan_guid}`
    })
    .reply(200, {
      resources: instances
    });
}

function getServiceInstancesInSpaceWithName(instance_name, space_guid, present) {
  let instances = [];
  if (present === true) {
    instances = [{
      metadata: {
        guid: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa'
      }
    }];
  }
  return nock(cloudControllerUrl)
    .get('/v2/service_instances')
    .query({
      q: [`space_guid:${space_guid}`, `name:${instance_name}`]
    })
    .reply(200, {
      resources: instances
    });
}

function findServicePlanByInstanceId(instance_id, plan_guid, plan_unique_id, resources, times) {
  const defaultResources = [{
    metadata: {
      guid: plan_guid
    },
    entity: {
      unique_id: plan_unique_id
    }
  }];
  return nock(cloudControllerUrl)
    .get('/v2/service_plans')
    .query({
      q: `service_instance_guid:${instance_id}`
    })
    .times(times || 1)
    .reply(200, {
      resources: resources ? resources : defaultResources
    });
}

function getSpaceDevelopers(space_guid, includeUser) {
  let resources = [{
    metadata: {
      guid: 'me'
    },
    entity: {
      username: 'me'
    }
  }, {
    metadata: {
      guid: 'admin'
    },
    entity: {
      username: 'admin'
    }
  }];

  if (includeUser) {
    resources.push({
      metadata: {
        guid: includeUser
      },
      entity: {
        username: includeUser
      }
    });
  }

  return nock(cloudControllerUrl, {
    reqheaders: {
      authorization: /^bearer/i
    }
  })
    .get(`/v2/spaces/${space_guid}/developers`)
    .reply(200, {
      next_url: null,
      resources: resources
    });
}
