'use strict';

const assume = require('assume');
const nock = require('nock');

const swagger = require('./apiserver-swagger.json');
const apiserver = require('../../eventmesh').server;


describe('eventmesh', () => {
  describe('ApiServerEventMesh', () => {
    beforeEach(() => {
      nock('https://127.0.0.1:9443')
        .get('/swagger.json')
        .reply(200, swagger);
    });

    describe('getResource', () => {
      it('returns the specified resource', done => {
        nock('https://127.0.0.1:9443')
          .get('/apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/d1')
          .reply(200, {
            message: 'ta dah'
          });
        apiserver.getResource('deployment', 'director', 'd1')
          .then(res => {
            assume(res.statusCode).is.equal(200);
            assume(res.body.message).is.equal('ta dah');
            done();
          })
          .catch(done);
      });
    });


  });
});



// const Promise = require('bluebird');
// const CONST = require('../../common/constants');
// const eventmesh = require('../../eventmesh');
// const kc = require('kubernetes-client');


// describe('eventmesh', () => {
//   describe('ApiServerEventMesh', () => {
//     let sandbox, valueStub, stringStub, jsonStub, putstub, getstub, prefixWatcherStub, keyWatcherStub;
//     before(() => {
//       sandbox = sinon.sandbox.create();
//       valueStub = sandbox.stub();
//       stringStub = sandbox.stub();
//       jsonStub = sandbox.stub();
//       putstub = sandbox.stub(Etcd3.prototype, 'put', () => {
//         return {
//           value: (val) => Promise.resolve(valueStub(val))
//         };
//       });
//       getstub = sandbox.stub(Etcd3.prototype, 'get', () => {
//         return {
//           json: () => Promise.resolve(jsonStub()),
//           string: () => Promise.resolve(stringStub()),
//         };
//       });

//       prefixWatcherStub = sandbox.stub().returns({
//         create: () => Promise.resolve({
//           on: () => Promise.resolve('prefixWatcherStubResponse')
//         }),
//       });
//       keyWatcherStub = sandbox.stub().returns({
//         create: () => Promise.resolve({
//           on: () => Promise.resolve('keyWatcherStubResponse')
//         }),
//       });
//       sandbox.stub(Etcd3.prototype, 'watch', () => {
//         return {
//           prefix: prefixWatcherStub,
//           key: keyWatcherStub
//         };
//       });
//     });

//     afterEach(function () {
//       valueStub.reset();
//       prefixWatcherStub.reset();
//       keyWatcherStub.reset();
//       putstub.reset();
//       getstub.reset();
//       jsonStub.reset();
//       stringStub.reset();
//     });

//     after(function () {
//       sandbox.restore();
//     });

//     describe('#createResource', () => {
//       it('should set options, state and lastoperation keys for new resource', () => {
//         return eventmesh.server.createResource('fakeResourceType', 'fakeResourceId', 'fakeValue')
//           .then(() => {
//             /* jshint expr: true */
//             expect(putstub.getCall(0).calledWithExactly('deployments/fakeResourceType/fakeResourceId/options')).to.be.true;
//             expect(putstub.getCall(1).calledWithExactly('deployments/fakeResourceType/fakeResourceId/state')).to.be.true;
//             expect(putstub.getCall(2).calledWithExactly('deployments/fakeResourceType/fakeResourceId/lastoperation')).to.be.true;
//             expect(valueStub.getCall(0).calledWithExactly('fakeValue')).to.be.true;
//             expect(valueStub.getCall(1).calledWithExactly(CONST.RESOURCE_STATE.IN_QUEUE)).to.be.true;
//             expect(valueStub.getCall(2).calledWithExactly('')).to.be.true;
//           });
//       });
//     });

//   });
// });