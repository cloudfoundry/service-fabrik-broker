'use strict';

const Mongoose = require('mongoose');
const Promise = require('bluebird');
Promise.promisifyAll([require('mongoose/lib/model')]);
const mongoModel = require('mongoose/lib/model');
const CONST = require('../../common/constants');
const Repository = require('../../common/db').Repository;

const time = Date.now();
const repeatInterval = '*/1 * * * *';
const repeatTimezone = 'America/New_York';
const username = 'hugo';
const getJob = (instanceId, dateTime) => {
  return Promise.resolve({
    _id: `${instanceId}-12121`,
    name: `${instanceId}_${CONST.JOB.SCHEDULED_BACKUP}`,
    repeatInterval: repeatInterval,
    data: {
      instance_id: instanceId,
      type: 'online'
    },
    nextRunAt: dateTime,
    lastRunAt: dateTime,
    lockedAt: null,
    repeatTimezone: repeatTimezone,
    createdAt: dateTime,
    updatedAt: dateTime,
    createdBy: username,
    updatedBy: username
  });
};
const instance_id = '9999-8888-7777-6666';
const instance_id2 = 'de99-8888-7777-66az';
const populateOpts = {};
const criteria = {
  name: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`
};
const aggregateCriteria = [{
  $match: criteria
}];
const listOfJobs = [];
for (let i = 1; i <= 10; i++) {
  let job = getJob(instance_id, Date.now()).value();
  job.instance_id = `${job.instance_id}-${i}`;
  listOfJobs.push(job);
}

class Query {
  constructor(data) {
    this.state = data;
  }
  lean() {
    return this;
  }
  execAsync() {
    return this.state;
  }
}

describe('db', function () {
  describe('Repository', function () {
    /* jshint unused:false */
    /* jshint expr:true */
    let modelStub, mongooseStub, sandbox, modelThat;

    before(function () {
      sandbox = sinon.sandbox.create();
      modelStub = function () {
        this.saveAsync = mongoModel.saveAsync;
        //All the below extension methods will not be inherited as they are not assigned against prototype.
        //Hence this special one method being added.
      };
      modelStub.findOne = sandbox.stub(mongoModel, 'findOne');
      modelStub.schema = {
        obj: {
          updatedAt: 'defined'
        }
      };
      modelStub.aggregate = sandbox.stub(mongoModel, 'aggregate');
      modelStub.findByIdAsync = sandbox.stub(mongoModel, 'findByIdAsync');
      modelStub.populateAsync = sandbox.stub(mongoModel, 'populateAsync');
      modelStub.removeAsync = sandbox.stub(mongoModel, 'removeAsync');
      mongoModel.saveAsync = () => {};
      modelStub.saveAsync = sandbox.stub(mongoModel, 'saveAsync');
      modelStub.findOneAndUpdateAsync = sandbox.stub(mongoModel, 'findOneAndUpdateAsync');
      modelStub.find = sandbox.stub(mongoModel, 'find', () => modelStub);
      modelStub.count = sandbox.stub(mongoModel, 'count', () => modelStub);
      mongoModel.skip = () => {};
      modelStub.skip = sandbox.stub(mongoModel, 'skip', () => modelStub);
      mongoModel.limit = () => {};
      modelStub.limit = sandbox.stub(mongoModel, 'limit', () => modelStub);
      mongoModel.execAsync = () => {};
      modelStub.execAsync = sandbox.stub(mongoModel, 'execAsync');
      mongooseStub = sandbox.stub(Mongoose, 'model', () => {
        return modelStub;
      });
    });

    beforeEach(function () {
      modelStub.findOne.withArgs(criteria).returns(new Query(getJob(instance_id, time)));
      modelStub.aggregate.withArgs(aggregateCriteria).returns(getJob(instance_id, time));
      modelStub.findOne.withArgs().returns(new Query(Promise.resolve(null)));
      modelStub.findByIdAsync.withArgs().returns(Promise.resolve(getJob(instance_id, time)));
      modelStub.populateAsync.withArgs().returns(getJob(instance_id, time));
      modelStub.removeAsync.withArgs(criteria).returns(Promise.resolve({}));
      modelStub.saveAsync.withArgs().returns(getJob(instance_id2, time));
      modelStub.findOneAndUpdateAsync.withArgs().returns(getJob(instance_id, time));
      modelStub.execAsync.onFirstCall().returns(Promise.resolve(20));
      modelStub.execAsync.onSecondCall().returns(Promise.resolve(listOfJobs));
    });

    afterEach(function () {
      modelStub.findOne.reset();
      modelStub.aggregate.reset();
      modelStub.findByIdAsync.reset();
      modelStub.populateAsync.reset();
      modelStub.removeAsync.reset();
      modelStub.saveAsync.reset();
      modelStub.findOneAndUpdateAsync.reset();
      modelStub.find.reset();
      modelStub.count.reset();
      modelStub.skip.reset();
      modelStub.limit.reset();
      mongoModel.execAsync.reset();
    });

    after(function () {
      sandbox.restore();
    });

    it('Should return the requested object from DB successfully', function () {
      return Repository.findOne(CONST.DB_MODEL.JOB, {
        name: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`
      }, populateOpts).then(response => {
        expect(modelStub.findOne).to.be.calledOnce;
        expect(modelStub.populateAsync).to.be.calledOnce;
        expect(response).to.eql(getJob(instance_id, time).value());
      });
    });

    it('Should return the object with requested id and populate opts from DB successfully', function () {
      return Repository.findById(CONST.DB_MODEL.JOB, {
        _id: instance_id,
      }, populateOpts).then(response => {
        expect(modelStub.findByIdAsync).to.be.calledOnce;
        expect(modelStub.populateAsync).to.be.calledOnce;
        expect(response).to.eql(getJob(instance_id, time).value());
      });
    });

    it('Should return the requested aggregated object from DB successfully', function () {
      return Repository.aggregate(CONST.DB_MODEL.JOB, aggregateCriteria).then(response => {
        expect(modelStub.aggregate).to.be.calledOnce;
        expect(response).to.eql(getJob(instance_id, time).value());
      });
    });

    it('Should return the count from DB successfully', function () {
      return Repository.count(CONST.DB_MODEL.JOB, criteria).then(response => {
        expect(modelStub.count).to.be.calledOnce;
      });
    });

    it('Should return null when requested for non-existing object', function () {
      return Repository.findOne(CONST.DB_MODEL.JOB, {
        name: `${instance_id}_NONAME`
      }).then(response => {
        expect(modelStub.findOne).to.be.calledOnce;
        expect(response).to.eql(null);
      });
    });

    it('Should delete the model with specific criteria successfully', function () {
      return Repository.delete(CONST.DB_MODEL.JOB, {
        name: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`
      }).then(response => {
        expect(modelStub.removeAsync).to.be.calledOnce;
        expect(response).to.eql({});
      });
    });

    it('Should Save an non-existing object', function () {
      return Repository.saveOrUpdate(CONST.DB_MODEL.JOB, getJob(instance_id2, time).value(), {
        name: `${instance_id2}_${CONST.JOB.SCHEDULED_BACKUP}`
      }, {
        'name': 'hugo'
      }).then(response => {
        expect(modelStub.saveAsync).to.be.calledOnce;
        expect(response).to.eql(getJob(instance_id2, time).value());
      });
    });

    it('Should throw error on save if user info is not provided', function () {
      return Repository.saveOrUpdate(CONST.DB_MODEL.JOB, getJob(instance_id2, time).value(), {
        name: `${instance_id2}_${CONST.JOB.SCHEDULED_BACKUP}`
      }).catch(err => {
        expect(err.message).to.eql('user.email or user.name is mandatory for save operation');
      });
    });

    it('Should throw error on save if criteria is not provided', function () {
      try {
        return Repository.saveOrUpdate(CONST.DB_MODEL.JOB, getJob(instance_id2, time).value());
      } catch (err) {
        expect(err.message).to.eql('SaveOrUpdate must have a non empty criteria object');
      }
    });

    it('Should Update an existing object', function () {
      return Repository.saveOrUpdate(CONST.DB_MODEL.JOB, getJob(instance_id, time).value(), criteria, {
        'name': 'hugo'
      }).then(response => {
        expect(modelStub.findOne).to.be.calledOnce;
        expect(modelStub.findOneAndUpdateAsync).to.be.calledOnce;
        expect(response).to.eql(getJob(instance_id, time).value());
      });
    });

    it('Should search a collection based on input criteria', function () {
      return Repository.search(CONST.DB_MODEL.JOB, {
        searchBy: {
          type: CONST.JOB.SCHEDULED_BACKUP
        }
      }, {
        records: 10,
        offset: 0
      }).then(response => {
        expect(modelStub.find).to.be.calledTwice;
        expect(modelStub.count).to.be.calledOnce;
        expect(modelStub.skip).to.be.calledOnce;
        expect(modelStub.limit).to.be.calledOnce;
        expect(modelStub.execAsync).to.be.calledTwice;
        expect(response).to.eql({
          list: listOfJobs,
          totalRecordCount: 20,
          nextOffset: 10
        });
      });
    });

    it('Should search a collection based if criteria and paginateOpts are not given', function () {
      return Repository.search(CONST.DB_MODEL.JOB).then(response => {
        expect(modelStub.find).to.be.calledTwice;
        expect(modelStub.count).to.be.calledOnce;
        expect(modelStub.skip).to.be.calledOnce;
        expect(modelStub.limit).to.be.calledOnce;
        expect(modelStub.execAsync).to.be.calledTwice;
        expect(response).to.eql({
          list: listOfJobs,
          totalRecordCount: 20,
          nextOffset: -1
        });
      });
    });
  });
});