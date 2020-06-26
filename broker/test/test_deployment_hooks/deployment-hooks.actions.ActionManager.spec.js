'use strict';

const _ = require('lodash');
const { CONST } = require('@sf/common-utils');
const ActionManager = require('../../applications/deployment_hooks/src/lib/actions/ActionManager');

describe('action', function () {
  describe('ActionManager', function () {
    const phase = CONST.SERVICE_LIFE_CYCLE.PRE_CREATE;
    const context = {};
    describe('executeActions', function () {
      it('should return not implemented if actions scripts are not provided', function () {
        const actions = ['MyAction'];
        return ActionManager.executeActions(phase, actions, context)
          .catch(err => {
            expect(err).to.have.status(501);
          });
      });
      it('should return correct action response', function () {
        const actions = ['Blueprint', 'ReserveIps'];
        const expectedResponse = {
          'Blueprint': {
            'precreate_input': {}
          },
          'ReserveIps': ['10.244.11.247']
        };
        return ActionManager.executeActions(phase, actions, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql(expectedResponse);
          });
      });
      it('should return void action response for js actions for all lifecycle phases', function () {
        const actions = ['ReserveIps'];
        const expectedResponse = {
          PreCreate: {
            ReserveIps: ['10.244.11.247']
          },
          PreBind: {
            ReserveIps: 0
          },
          PreDelete: {
            ReserveIps: 0
          },
          PreUnbind: {
            ReserveIps: 0
          },
          PreUpdate: {
            ReserveIps: 0
          }
        };
        let response = {};
        return Promise.map(_.values(CONST.SERVICE_LIFE_CYCLE), phase => {
          return ActionManager.executeActions(phase, actions, context)
            .then(res => response[phase] = res);
        })
          .then(() => {
            expect(response).to.eql(expectedResponse);
          });
      });
      it('should return void action response if phase is not lifecycle phase', function () {
        const actions = ['ReserveIps'];
        const testPhase = 'PrePhase';
        const expectedResponse = {
          ReserveIps: 0
        };
        return ActionManager.executeActions(testPhase, actions, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql(expectedResponse);
          });
      });
      it('should return void action response for shell action if some phase is not implemented', function () {
        const actions = ['Blueprint'];
        const testPhase = CONST.SERVICE_LIFE_CYCLE.PRE_UPDATE;
        const expectedResponse = {
          Blueprint: 0
        };
        return ActionManager.executeActions(testPhase, actions, context)
          .then(actionResponse => {
            expect(actionResponse).to.eql(expectedResponse);
          });
      });

    });
  });
});
