'use strict';

const _ = require('lodash');
const app = require('../support/apps').internal;
const config = require('../../../common/config');
const proxyquire = require('proxyquire');
const CONST = require('../../../common/constants');
const ServiceFabrikAdminController = require('../../../api-controllers/ServiceFabrikAdminController');
const numOfInstances = 2 * config.mongodb.record_max_fetch_count;

const getInstance = (instanceId) => {
  return Promise.resolve({
    _id: `${instanceId}-12121`,
    data: {
      instance_id: instanceId
    }
  });
};
const instanceId = '9999-8888-7777-6666';
const repositoryStub = {
  search: () => undefined
};
const listOfInstances = [];

for (let i = 1; i <= numOfInstances; i++) {
  let instance = getInstance(`${instanceId}-${i}`).value();
  listOfInstances.push(instance);
}

class Repository {
  static search(model, searchCriteria, paginateOpts) {
    let returnedList = []; {
      returnedList = listOfInstances;
      repositoryStub.search(arguments);
      return Promise.try(() => {
        let nextOffset = paginateOpts.offset + paginateOpts.records;
        nextOffset = nextOffset >= numOfInstances ? -1 : nextOffset;
        return {
          list: _.slice(returnedList, paginateOpts.offset, paginateOpts.offset + paginateOpts.records),
          totalRecordCount: 10,
          nextOffset: nextOffset
        };
      });
    }
  }
}

describe('service-fabrik-admin', function () {
  const base_url = '/admin';

  describe('#getScheduledUpdateInstances', function () {

    before(function () {
      sinon.stub(ServiceFabrikAdminController, 'getInstancesWithUpdateScheduled').returns(Promise.resolve([{
        instance_id: '9999-8888-7777-6666'
      }, {
        instance_id: '5555-4444-3333-2222'
      }]));
    });

    it.only('should list all instances with updates scheduled', function () {
      return chai
        .request(app)
        .get(`${base_url}/update/schedules`)
        .set('Accept', 'application/json')
        .auth(config.username, config.password)
        .catch(err => err.response)
        .then(res => {
          expect(res.body).to.have.length(2);
          expect(res).to.have.status(200);
        });
    });
  });

  describe('#getInstancesWithUpdateScheduled', function () {
    const adminController = proxyquire('../../../api-controllers/ServiceFabrikAdminController', {
      '../common/db': {
        Repository: Repository
      }
    });
    let repoSpy = sinon.stub(repositoryStub);
    let clock;

    before(function () {
      clock = sinon.useFakeTimers();
    });

    afterEach(function () {
      repoSpy.search.reset();
      clock.reset();
    });

    after(function () {
      clock.restore();
    });

    it('should get all instances with updates scheduled from database', function () {

      const expectedInstanceList = [];
      expectedInstanceList.push.apply(expectedInstanceList, _.map(listOfInstances, 'data'));
      const criteria = {
        searchBy: {
          type: CONST.JOB.SERVICE_INSTANCE_UPDATE
        },
        projection: {
          'data.instance_id': 1
        }
      };
      const paginateOpts = {
        records: config.mongodb.record_max_fetch_count,
        offset: config.mongodb.record_max_fetch_count
      };

      return adminController
        .getInstancesWithUpdateScheduled()
        .then(instances => {
          expect(instances).to.eql(expectedInstanceList);
          expect(repoSpy.search.callCount).to.equal(2);
          expect(repoSpy.search.firstCall.args[0][0]).to.be.equal(CONST.DB_MODEL.JOB);
          expect(repoSpy.search.firstCall.args[0][1]).to.deep.equal(criteria);
          expect(repoSpy.search.firstCall.args[0][2]).to.deep.equal(paginateOpts);
        });
    });
  });
});