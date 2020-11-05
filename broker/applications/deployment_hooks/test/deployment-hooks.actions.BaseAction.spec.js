'use strict';

const _ = require('lodash');
const { CONST } = require('@sf/common-utils');
const BaseAction = require('../src/lib/actions/js/BaseAction');

describe('action', function () {
  describe('BaseAction', function () {
    it('should have all prelifecycle hooks definition', function () {
      const response = {};
      const expectedResponse = {
        PreCreate: 0,
        PreBind: 0,
        PreDelete: 0,
        PreUnbind: 0,
        PreUpdate: 0
      };
      return Promise.map(_.values(CONST.SERVICE_LIFE_CYCLE), phase => {
        return BaseAction[`execute${phase}`]()
          .then(res => response[phase] = res);
      })
        .then(() => {
          expect(response).to.eql(expectedResponse);
        });
    });
  });
});
