// 'use strict';

// const proxyquire = require('proxyquire');
// const CONST = require('../../common/constants');
// const NetworkSegmentIndex = require('../../data-access-layer/bosh/NetworkSegmentIndex');

// describe('fabrik', function () {
//   const params = {
//     test: 'val'
//   };
//   const args = {
//     test: 'arg'
//   };
//   describe('DirectorTaskPoller', () => {
//     let directorTaskPoller;
//     let sandbox;
//     let codSpy, getNamesSpy, getDeploymentSpy, getPlanSpy, subscribeSpy, startSpy;
//     let directorService;
//     let findDeploymentNameByInstanceIdSpy, createOrUpdateDeploymentSpy;

//     beforeEach(() => {
//       sandbox = sinon.sandbox.create();
//       codSpy = sandbox.stub();
//       getNamesSpy = sandbox.stub();
//       getDeploymentSpy = sandbox.stub();
//       getPlanSpy = sandbox.stub();
//       subscribeSpy = sandbox.stub();
//       findDeploymentNameByInstanceIdSpy = sandbox.stub();
//       createOrUpdateDeploymentSpy = sandbox.stub();

//       directorService = {
//         findDeploymentNameByInstanceId: findDeploymentNameByInstanceIdSpy,
//         createOrUpdateDeployment: createOrUpdateDeploymentSpy
//       };
//       const DirectorTaskPoller = proxyquire('../../broker/lib/fabrik/DirectorTaskPoller', {
//         '../../../managers/bosh-manager': {
//           DirectorService: directorService
//         }
//       });
//       directorTaskPoller = new DirectorTaskPoller({
//         time_interval: 1 * 60 * 1000
//       });
//     });

//     afterEach(() => {
//       sandbox.restore();
//     });

//     const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
//     const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
//     // const plan_id_forced_update = 'fc158c9a-7934-401e-94ab-057082a5073f';
//     // const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
//     const organization_guid = 'b8cbbac8-6a20-42bc-b7db-47c205fccf9a';
//     const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
//     const index = NetworkSegmentIndex.adjust(mocks.director.networkSegmentIndex);
//     const instance_id = mocks.director.uuidByIndex(index);
//     const payload = [{
//       apiVersion: 'deployment.servicefabrik.io/v1alpha1',
//       kind: 'Director',
//       metadata: {
//         annotations: {
//           lockedByManager: '',
//           lockedByTaskPoller: '{\"lockTime\":\"2018-09-06T16:38:34.919Z\",\"ip\":\"10.0.2.2\"}'
//         },
//         creationTimestamp: '2018-09-06T16:01:28Z',
//         generation: 1,
//         labels: {
//           state: 'succeeded'
//         },
//         name: instance_id,
//         namespace: 'default',
//         resourceVersion: '3364',
//         selfLink: `/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/${instance_id}`,
//         uid: '1d48b3f3-b1ee-11e8-ac2a-06c007f8352b'

//       },
//       spec: {
//         options: JSON.stringify({
//           service_id: service_id,
//           plan_id: plan_id,
//           context: {
//             platform: 'cloudfoundry',
//             organization_guid: organization_guid,
//             space_guid: space_guid
//           },
//           organization_guid: organization_guid,
//           space_guid: space_guid
//         })
//       },
//       status: {
//         state: 'succeeded',
//         lastOperation: '{}',
//         response: '{}'
//       }
//     }];


//     it.only('should consume any error thrown from the action handler: getDeploymentNames', () => {
//       mocks.apiServerEventMesh.nockGetResourceListByState(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
//         CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
//         [CONST.APISERVER.RESOURCE_STATE.IN_CACHE], payload, 1, 200);
//       getNamesSpy.returns(Promise.reject(new Error('get_error')));
//       getDeploymentSpy.returns(Promise.resolve({
//         plan_id: 'plan',
//         params: params,
//         args: args
//       }));
//       codSpy.returns(Promise.resolve());
//       directorTaskPoller.triggerStaggeredDeployments().then(() => {
//         expect(getNamesSpy.callCount).to.eql(1);
//         expect(getDeploymentSpy.callCount).to.eql(0);
//         expect(getPlanSpy.callCount).to.eql(0);
//         expect(codSpy.callCount).to.eql(0);
//       });
//     });
//     it('should consume any error thrown from the action handler: getDeploymentByName', () => {
//       getNamesSpy.returns(Promise.resolve(['1', '2', '3']));
//       getDeploymentSpy.returns(Promise.reject(new Error('deployment_error')));
//       codSpy.returns(Promise.resolve());
//       subject.action().then(() => {
//         expect(getNamesSpy.callCount).to.eql(1);
//         expect(getDeploymentSpy.callCount).to.eql(3);
//         expect(getPlanSpy.callCount).to.eql(0);
//         expect(codSpy.callCount).to.eql(0);
//       });
//     });
//     it('should call the action handler successfully', () => {
//       getNamesSpy.returns(Promise.resolve(['1', '2', '3']));
//       getDeploymentSpy.returns(Promise.resolve({
//         plan_id: 'plan',
//         params: params,
//         args: args
//       }));
//       codSpy.returns(Promise.resolve());
//       subject.action().then(() => {
//         expect(getNamesSpy.callCount).to.eql(1);
//         expect(getDeploymentSpy.callCount).to.eql(3);
//         expect(getDeploymentSpy.firstCall.calledWithExactly('1')).to.eql(true);
//         expect(getDeploymentSpy.secondCall.calledWithExactly('2')).to.eql(true);
//         expect(getDeploymentSpy.thirdCall.calledWithExactly('3')).to.eql(true);
//         expect(getPlanSpy.callCount).to.eql(3);
//         expect(getPlanSpy.firstCall.calledWithExactly('plan')).to.eql(true);
//         expect(getPlanSpy.secondCall.calledWithExactly('plan')).to.eql(true);
//         expect(getPlanSpy.thirdCall.calledWithExactly('plan')).to.eql(true);
//         expect(codSpy.callCount).to.eql(3);
//         expect(codSpy.firstCall.calledWithExactly('1', params, args)).to.eql(true);
//         expect(codSpy.secondCall.calledWithExactly('2', params, args)).to.eql(true);
//         expect(codSpy.thirdCall.calledWithExactly('3', params, args)).to.eql(true);
//       });
//     });
//   });
// });