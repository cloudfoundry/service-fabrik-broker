'use strict';

const _ = require('lodash');
const MeterInstanceJob = require('../../jobs/MeterInstanceJob');
const CONST = require('../../common/constants');
const EventLogInterceptor = require('../../common/EventLogInterceptor');

const meterGuid = 'meter-guid';
const not_excluded_plan = 'bc158c9a-7934-401e-94ab-057082a5073f';
let options_json = {
  id: meterGuid,
  timestamp: '2019-01-21T11:00:42.384518Z',
  service: {
    service_guid: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
    plan_guid: not_excluded_plan
  },
  consumer: {
    environment: '',
    region: '',
    org: '33915d88-6002-4e83-b154-9ec2075e1435',
    space: 'bd78dbbb-5225-4dfa-94e0-816a4de9b7c9',
    instance: '4e099918-1b37-42a8-9dbd-a752225fcd07'
  },
  measues: [{
    id: 'instances',
    value: 'start'
  }]
};

function getDummyEvent(options_json) {
  let dummy_event = {
    apiVersion: 'instance.servicefabrik.io/v1alpha1',
    kind: 'Sfevent',
    metadata: {
      clusterName: '',
      creationTimestamp: '2019-01-21T11:00:43Z',
      generation: 1,
      labels: {
        state: 'TO_BE_METERED',
        instance_guid: 'fake_instance_id',
        event_type: 'update'
      },
      name: meterGuid,
      namespace: 'default',
      resourceVersion: '326999',
      selfLink: '/apis/instance.servicefabrik.io/v1alpha1/namespaces/default/sfevents/48eb2e1e-dbfa-4554-9663-273418437e90',
      uid: 'cbf0c777-1d6b-11e9-806d-0e655bfa3b31'
    },
    spec: {
      metadata: {
        creationTimestamp: null
      },
      options: options_json
    }
  };
  return dummy_event;
}

describe('Jobs', () => {
  describe('MeterInstanceJobs', () => {

    describe('#run', () => {
      it('run the job', () => {
        const index = mocks.director.networkSegmentIndex;
        const instance_id = mocks.director.uuidByIndex(index);
        const job = {
          attrs: {
            name: `${instance_id}_${CONST.JOB.METER_INSTANCE}`,
            data: {
              delete_delay: 0
            },
            lastRunAt: new Date(),
            nextRunAt: new Date(),
            repeatInterval: '*/1 * * * *',
            lockedAt: null,
            repeatTimezone: 'America/New_York'
          },
          fail: () => undefined,
          save: () => undefined,
          touch: () => undefined
        };
        // Expected calls
        const dummy_events = [getDummyEvent(options_json)];
        // Call to apiserver to get resources
        mocks.apiServerEventMesh.nockGetResources(
          CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, {
            items: dummy_events
          }, {
            labelSelector: `state in (${CONST.METER_STATE.TO_BE_METERED},${CONST.METER_STATE.FAILED})`
          }, 1, 200);
        // Call to MaaS to get token
        const mock_response_code = 200;
        mocks.metering.mockAuthCall(mock_token);
        // Call to MaaS to send usage record
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        // call to apiserver to patch
        const expectedResponse = {
          status: 200
        };
        const payload = {
          status: {
            state: CONST.METER_STATE.METERED
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        return MeterInstanceJob.run(job, () => {
          mocks.verify();
        });
      });
    });

    describe('#getInstanceEvents', () => {
      it('should get all instance evetnts', () => {
        const dummy_events = [getDummyEvent(options_json)];
        mocks.apiServerEventMesh.nockGetResources(
          CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, {
            items: dummy_events
          }, {
            labelSelector: `state in (${CONST.METER_STATE.TO_BE_METERED},${CONST.METER_STATE.FAILED})`
          }, 1, 200);
        return MeterInstanceJob.getInstanceEvents()
          .then(evts => {
            mocks.verify();
            expect(evts[0].metadata.creationTimestamp).to.equal(dummy_events[0].metadata.creationTimestamp);
          });
      });
      it('should get instance_events of only passed instance', () => {
        const dummy_events = [getDummyEvent(options_json)];
        const fake_guid = 'fake_instance_guid';
        let selector = `state in (${CONST.METER_STATE.TO_BE_METERED},${CONST.METER_STATE.FAILED})`;
        selector = selector + `,instance_guid=${fake_guid}`;
        mocks.apiServerEventMesh.nockGetResources(
          CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, {
            items: dummy_events
          }, {
            labelSelector: selector
          }, 1, 200);
        return MeterInstanceJob.getInstanceEvents({
          instance_guid: fake_guid
        })
          .then(evts => {
            mocks.verify();
            expect(evts[0].metadata.creationTimestamp).to.equal(dummy_events[0].metadata.creationTimestamp);
          });
      });
    });


    describe('#getInstanceType', () => {
      it('should get the instance type as docker when SKU contain dev', () => {
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';
        const dummy_event = getDummyEvent(options_json);
        const val = MeterInstanceJob.getInstanceType(dummy_event)
        expect(val).to.eql(CONST.INSTANCE_TYPE.DOCKER);
      });
      it('should get the instance type as director when SKU does not contain dev', () => {
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = 'bc158c9a-7934-401e-94ab-057082a5073f';
        const dummy_event = getDummyEvent(options_json);
        const val = MeterInstanceJob.getInstanceType(dummy_event)
        expect(val).to.eql(CONST.INSTANCE_TYPE.DIRECTOR);
      });
    });

    describe('#sendEvent', () => {

      let publishAndAuditLogEventStub;
      publishAndAuditLogEventStub = sinon.stub(EventLogInterceptor.prototype, 'publishAndAuditLogEvent');

      beforeEach(function () {
          publishAndAuditLogEventStub.resetHistory();
      });
      afterEach(function () {
        publishAndAuditLogEventStub.resetHistory();
      });

      after(function(){
        publishAndAuditLogEventStub.restore();
      });

      it('should not send metering event for excluded plans', () => {
        const expectedResponse = {
          status: 200
        };
        const payload = {
          status: {
            state: CONST.METER_STATE.EXCLUDED
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        // updated the dummy event with exluded plans
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = '466c5078-df6e-427d-8fb2-c76af50c0f56';
        const dummy_event = getDummyEvent(options_json);
        return MeterInstanceJob.sendEvent(dummy_event)
          .then(res => {
            expect(res).to.eql(true);
            expect(publishAndAuditLogEventStub).to.be.not.called;
            mocks.verify();
          });
      });
      it('should send document to metering and update state in apiserver', () => {
        const expectedResponse = {
          status: 200
        };
        const payload = {
          status: {
            state: CONST.METER_STATE.METERED
          }
        };
        const mock_response_code = 200;
        mocks.metering.mockAuthCall(mock_token);
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        // updated the dummy event with not exluded plans
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = not_excluded_plan;
        const dummy_event = getDummyEvent(options_json);
        return MeterInstanceJob.sendEvent(dummy_event)
          .then(res => {
            expect(res).to.eql(true);
            expect(publishAndAuditLogEventStub).to.be.calledOnce;
            expect(publishAndAuditLogEventStub.firstCall.args[0]).to.eql(CONST.URL.METERING_USAGE);
            expect(publishAndAuditLogEventStub.firstCall.args[1]).to.eql(CONST.HTTP_METHOD.PUT);
            expect(publishAndAuditLogEventStub.firstCall.args[2]).to.eql({ 
              "event_type": 'update',
              instance_id: 'fake_instance_id'
            });
            expect(publishAndAuditLogEventStub.firstCall.args[3]).to.eql({ statusCode: 200 });
            mocks.verify();
          });
      });
      it('should update state in apiserver if sending document fails', () => {
        const expectedResponse = {
          status: 200
        };
        const payload = {
          status: {
            state: CONST.METER_STATE.FAILED
          }
        };
        const mock_response_code = 400;
        mocks.metering.mockAuthCall(mock_token);
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        // updated the dummy event with not exluded plans
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = not_excluded_plan;
        const dummy_event = getDummyEvent(options_json);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        return MeterInstanceJob.sendEvent(dummy_event, 1)
          .then(res => {
            expect(res).to.eql(false);
            expect(publishAndAuditLogEventStub).to.be.calledOnce;
            expect(publishAndAuditLogEventStub.firstCall.args[0]).to.eql(CONST.URL.METERING_USAGE);
            expect(publishAndAuditLogEventStub.firstCall.args[1]).to.eql(CONST.HTTP_METHOD.PUT);
            expect(publishAndAuditLogEventStub.firstCall.args[2]).to.eql({ 
              "event_type": 'update',
              instance_id: 'fake_instance_id'
            });
            expect(publishAndAuditLogEventStub.firstCall.args[3]).to.eql({ statusCode: CONST.HTTP_STATUS_CODE.TIMEOUT });
            mocks.verify();
          })
      });
      it('should retry if sending document fails', () => {
        const expectedResponse = {
          status: 200
        };
        const payload = {
          status: {
            state: CONST.METER_STATE.FAILED
          }
        };
        const mock_response_code = 400;
        // first call
        mocks.metering.mockAuthCall(mock_token);
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        // second retry
        mocks.metering.mockAuthCall(mock_token);
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        // updated the dummy event with not exluded plans
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = not_excluded_plan;
        const dummy_event = getDummyEvent(options_json);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        return MeterInstanceJob.sendEvent(dummy_event, 2)
          .then(res => {
            expect(res).to.eql(false);
            mocks.verify();
          })
          .catch(err => expect(err).to.be.undefined);
      });
    });

    describe('#enrichEvent', () => {
      it('Should create new object with service id and plan sku', () => {
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = not_excluded_plan;
        expect(MeterInstanceJob.enrichEvent(options_json)).to.eql({
          'consumer': {
            'environment': '',
            'instance': '4e099918-1b37-42a8-9dbd-a752225fcd07',
            'org': '33915d88-6002-4e83-b154-9ec2075e1435',
            'region': 'asia',
            'space': 'bd78dbbb-5225-4dfa-94e0-816a4de9b7c9'
          },
          'id': 'meter-guid',
          'measues': [{
            'id': 'instances',
            'value': 'start'
          }],
          'service': {
            'id': 'blueprint',
            'plan': 'xsmall'
          },
          'timestamp': '2019-01-21T11:00:42.384518Z'
        });
      });
    });


    const mock_token = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9';
    describe('#meter', () => {
      it('Should send event for all documents', () => {
        //Send doucments to metering service 2 times
        const mock_response_code = 200;
        const expectedResponse = {
          status: 200
        };
        const payload = {
          status: {
            state: CONST.METER_STATE.METERED
          }
        };
        mocks.metering.mockAuthCall(mock_token);
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        mocks.metering.mockAuthCall(mock_token);
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        // updated the dummy event with not exluded plans
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = not_excluded_plan;
        const dummy_event = getDummyEvent(options_json);
        // update apiserver for the 2 events
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        return MeterInstanceJob.meter([dummy_event, _.cloneDeep(dummy_event)])
          .then(res => {
            expect(res.totalEvents).to.eql(2);
            expect(res.success).to.eql(2);
            expect(res.failed).to.eql(0);
          })
          .catch(err => expect(err).to.be.undefined);
      });
      it('Should keep tab of failed events', () => {
        //Send doucments to metering service 2 times
        const mock_response_code = 200;
        const mock_response_code_failure = 400;
        const expectedResponse = {
          status: 200
        };
        const payload = {
          status: {
            state: CONST.METER_STATE.METERED
          }
        };
        const payload_failure = {
          status: {
            state: CONST.METER_STATE.FAILED
          }
        };
        mocks.metering.mockAuthCall(mock_token);
        // mock successfull put req
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code, () => {
          return true;
        });
        mocks.metering.mockAuthCall(mock_token);
        // mock failed put req
        mocks.metering.mockSendUsageRecord(mock_token, mock_response_code_failure, () => {
          return true;
        });
        // updated the dummy event with not exluded plans
        options_json.service.service_guid = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
        options_json.service.plan_guid = not_excluded_plan;
        const dummy_event = getDummyEvent(options_json);
        // update apiserver for the 2 events
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE,
          CONST.APISERVER.RESOURCE_TYPES.SFEVENT, meterGuid, expectedResponse, 1, payload_failure);
        return MeterInstanceJob.meter([dummy_event, _.cloneDeep(dummy_event)], 1)
          .then(res => {
            expect(res.totalEvents).to.eql(2);
            expect(res.success).to.eql(1);
            expect(res.failed).to.eql(1);
          });
      });
    });
  });
});