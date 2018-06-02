'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const subject = require('../../broker/lib/bosh').BoshOperationQueue;
const {
  Etcd3
} = require('etcd3');

class PutStubber {
  constructor(hash, k, fail) {
    this.hash = _.cloneDeep(hash);
    this.key = k;
    this.fail = fail;
  }
  value(v) {
    this.hash[this.key] = v;
    return this;
  }
  then(fn, rej) {
    return Promise.try(() => {
      if (this.fail) {
        if (rej) {
          return rej(new Error('etcd_error'));
        }
        throw new Error('etcd_error');
      }
      if (fn) {
        return fn(this.hash);
      }
    });
  }
  catch (fn) {
    let p = new Promise((resolve, reject) => {
      if (this.fail) {
        try {
          fn(new Error('etcd_error'));
          return resolve(true);
        } catch (e) {
          return reject(e);
        }
      } else {
        return resolve(true);
      }
    });
    return p;
  }
}

class DeleteStubber {
  constructor(hash, fail) {
    this.hash = _.cloneDeep(hash);
    this.fail = fail;
    this.out = {
      deleted: 0
    };
  }
  key(k) {
    this.key = k;
    if (this.hash.hasOwnProperty(k)) {
      delete this.hash[k];
      this.out.deleted = this.out.deleted + 1;
    }
    return this;
  }
  then(fn, rej) {
    return Promise.try(() => {
      if (this.fail) {
        if (rej) {
          return rej(new Error('etcd_error'));
        }
        throw new Error('etcd_error');
      }
      if (fn) {
        return fn(this.out);
      }
    });
  }
  catch (fn) {
    let p = new Promise((o) => {
      return fn(o);
    });
    if (this.fail) {
      p.resolve(new Error('etcd_error'));
    }
    return p;
  }
}
class SingleRangeStubber {
  constructor(hash, k, fail) {
    this.hash = hash;
    this.key = k;
    this.fail = fail;
    this.value = this._get(k);
  }
  json() {
    return Promise.try(() => {
      if (this.value) {
        return JSON.parse(this.value);
      }
      return null;
    });
  }
  string() {
    if (this.hash.hasOwnProperty(this.key)) {
      return Promise.resolve(this.hash[this.key]);
    }
    return Promise.resolve(null);
  }
  number() {
    if (this.hash.hasOwnProperty(this.key)) {
      return Promise.resolve(parseInt(this.hash[this.key]));
    }
    return Promise.resolve(Number.NaN);
  }
  _get(k) {
    if (this.hash.hasOwnProperty(k)) {
      const o = {};
      o[k] = this.hash[k];
      return JSON.stringify(o);
    }
    return null;
  }
  then(fn, rej) {
    return Promise.try(() => {
      if (this.fail) {
        if (rej) {
          return rej(new Error('etcd_error'));
        }
        throw new Error('etcd_error');
      }
      if (fn) {
        return fn(this.value);
      }
    });
  }
  catch (fn) {
    let p = new Promise((o) => {
      return fn(o);
    });
    if (this.fail) {
      p.resolve(new Error('etcd_error'));
    }
    return p;
  }
}

class MultiRangeStubber {
  constructor(entrykeys, fail) {
    this.entrykeys = entrykeys;
    this.fail = fail;
    this.intermediate = [];
  }

  then() {
    return;
  }

  all() {
    return this;
  }

  keys() {
    if (this.fail) {
      return Promise.reject(new Error('etcd_error'));
    }
    return Promise.resolve(this.intermediate);
  }

  limit(n) {
    if (this.intermediate.length === 0) {
      this.intermediate = this.entrykeys;
    }
    this.intermediate = this.intermediate.slice(0, n);
    return this;
  }

  prefix(p) {
    this.intermediate = this.entrykeys.filter(k => k.startsWith(p));
    return this;
  }

  sort() {
    this.intermediate.sort();
    return this;
  }
}

describe('bosh operation cache in etcd', () => {
  describe('#containsBoshTask', () => {
    let sandbox, getStub;
    let hash = {
      'bosh/tasks/1': {},
      'bosh/tasks/2': {},
      'bosh/deployments/1': {}
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should return true if task is in cache', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k));
      return subject.containsBoshTask('1').then(o => {
        expect(o).to.eql(true);
      });
    });
    it('should return false if task is not in cache', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k));
      return subject.containsBoshTask('3').then(o => {
        expect(o).to.eql(false);
      });
    });
    it('should throw error if etcd throws', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k, true));
      return subject.containsBoshTask('3').catch(err => {
        expect(err.message).to.eql('etcd_error');
      });
    });
  });
  describe('#containsDeployment', () => {
    let sandbox, getStub;
    let hash = {
      'bosh/deployments/1': {},
      'bosh/deployments/2': {},
      'bosh/tasks/1': {}
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should return true if deployment is in cache', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k));
      return subject.containsDeployment('1').then(o => {
        expect(o).to.eql(true);
      });
    });
    it('should return false if deployment is not in cache', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k));
      return subject.containsDeployment('3').then(o => {
        expect(o).to.eql(false);
      });
    });
  });
  describe('#getBoshTask', () => {
    let sandbox, getStub;
    let hash = {
      'bosh/deployments/1': {},
      'bosh/deployments/2': {},
      'bosh/tasks/1': 'abcd',
      'bosh/tasks/2': 'bcde'
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should return task id if service instance id is in cache', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k));
      return subject.getBoshTask('1').then(o => {
        expect(o).to.eql('abcd');
      });
    });
    it('should throw error if get task fails', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k, true));
      return subject.getBoshTask('3').catch(err => {
        expect(err.message).to.eql('etcd_error');
      });
    });
  });
  describe('#getDeploymentByName', () => {
    let sandbox, getStub;
    let hash = {
      'bosh/deployments/1': {
        key: 'abcd'
      },
      'bosh/deployments/2': {
        key: 'bcde'
      },
      'bosh/tasks/1': 'abcd',
      'bosh/tasks/2': 'bcde'
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should return deployment if name is in cache', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k));
      return subject.getDeploymentByName('1').then(o => {
        expect(o).to.eql({
          key: 'abcd'
        });
      });
    });
    it('should throw error if getting deployment fails', () => {
      getStub = sandbox.stub(Etcd3.prototype, 'get', (k) => new SingleRangeStubber(hash, k, true));
      return subject.getDeploymentByName('1').catch(err => {
        expect(err.message).to.eql('etcd_error');
      });
    });
  });
  describe('#saveBoshTask', () => {
    let sandbox, putStub;
    let hash = {
      'bosh/deployments/1': {
        key: 'abcd'
      },
      'bosh/deployments/2': {
        key: 'bcde'
      },
      'bosh/tasks/1': 'abcd',
      'bosh/tasks/2': 'bcde'
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should store task for instance id in cache', () => {
      putStub = sandbox.stub(Etcd3.prototype, 'put', (k) => new PutStubber(hash, k));
      return subject.saveBoshTask('3', 'new').then(o => {
        expect(o).to.eql(true);
      });
    });
    it('should throw error if storing bosh task fails', () => {
      putStub = sandbox.stub(Etcd3.prototype, 'put', (k) => new PutStubber(hash, k, true));
      return subject.saveBoshTask('1').catch(err => {
        expect(err.message).to.include('etcd_error');
      });
    });
  });
  describe('#storeDeployment', () => {
    let sandbox, putStub, containsStub;
    let hash = {
      'bosh/deployments/1': {
        key: 'abcd'
      },
      'bosh/deployments/2': {
        key: 'bcde'
      },
      'bosh/tasks/1': 'abcd',
      'bosh/tasks/2': 'bcde'
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should store deployment in cache if absent previously', () => {
      putStub = sandbox.stub(Etcd3.prototype, 'put', (k) => new PutStubber(hash, k));
      containsStub = sandbox.stub(subject, 'containsDeployment', () => Promise.resolve(false));
      return subject.saveDeployment('plan_id', '4', {
        param: 'value'
      }, {
        arg: 'val'
      }).then(o => {
        expect(o).to.eql(true);
      });
    });
    it('should not store again if previously present in cache', () => {
      putStub = sandbox.stub(Etcd3.prototype, 'put', (k) => new PutStubber(hash, k));
      containsStub = sandbox.stub(subject, 'containsDeployment', () => Promise.resolve(true));
      return subject.saveDeployment('plan_id', '4', {}, {}).then(o => {
        expect(o).to.eql(false);
      });
    });
    it('should throw cache update error if store op fails', () => {
      putStub = sandbox.stub(Etcd3.prototype, 'put', (k) => new PutStubber(hash, k, true));
      containsStub = sandbox.stub(subject, 'containsDeployment', () => Promise.resolve(false));
      return subject.saveDeployment('plan_id', '5', {}, {}).catch(err => {
        expect(err.code).to.eql('ETCDERROR');
      });
    });
  });
  describe('#getNEntries', () => {
    let sandbox, getAllStub;
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should return limited entries of deployment names from cache', () => {
      getAllStub = sandbox.stub(Etcd3.prototype, 'getAll', () => new MultiRangeStubber(['bosh/deployments/1', 'bosh/deployments/2', 'bosh/deployments/3', 'bosh/tasks/1']));
      return subject.getNEntries(2).then(o => {
        expect(o.length).to.eql(2);
        expect(o).to.eql(['1', '2']);
      });
    });
  });
  describe('#getDeploymentNames', () => {
    let sandbox, getAllStub;
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should return all deployment names from cache', () => {
      getAllStub = sandbox.stub(Etcd3.prototype, 'getAll', () => new MultiRangeStubber(['bosh/deployments/1', 'bosh/deployments/2', 'bosh/deployments/3', 'bosh/tasks/1']));
      return subject.getDeploymentNames().then(o => {
        expect(o.length).to.eql(3);
        expect(o).to.eql(['1', '2', '3']);
      });
    });
  });
  describe('#deleteBoshTask', () => {
    let sandbox, deleteStub;
    let hash = {
      'bosh/deployments/1': {
        key: 'abcd'
      },
      'bosh/deployments/2': {
        key: 'bcde'
      },
      'bosh/tasks/1': 'abcd',
      'bosh/tasks/2': 'bcde'
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should delete bosh task entry for service instance from cache', () => {
      deleteStub = sandbox.stub(Etcd3.prototype, 'delete', () => new DeleteStubber(hash));
      return subject.deleteBoshTask('1').then(o => {
        expect(o.deleted).to.eql(1);
      });
    });
    it('should not delete task entry from cache if instance id not found', () => {
      deleteStub = sandbox.stub(Etcd3.prototype, 'delete', () => new DeleteStubber(hash));
      return subject.deleteBoshTask('3').then(o => {
        expect(o.deleted).to.eql(0);
      });
    });
  });
  describe('#deleteDeploymentFromCache', () => {
    let sandbox, deleteStub;
    let hash = {
      'bosh/deployments/1': {
        key: 'abcd'
      },
      'bosh/deployments/2': {
        key: 'bcde'
      },
      'bosh/tasks/1': 'abcd',
      'bosh/tasks/2': 'bcde'
    };
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should delete deployment name from cache', () => {
      deleteStub = sandbox.stub(Etcd3.prototype, 'delete', () => new DeleteStubber(hash));
      return subject.deleteDeploymentFromCache('1').then(o => {
        expect(o.deleted).to.eql(1);
      });
    });
    it('should not delete deployment name from cache if not found', () => {
      deleteStub = sandbox.stub(Etcd3.prototype, 'delete', () => new DeleteStubber(hash));
      return subject.deleteDeploymentFromCache('3').then(o => {
        expect(o.deleted).to.eql(0);
      });
    });
    it('should delete multiple deployment names from cache', () => {
      deleteStub = sandbox.stub(Etcd3.prototype, 'delete', () => new DeleteStubber(hash));
      return subject.deleteDeploymentsFromCache('1', '2', '3').spread((o1, o2, o3) => {
        expect(o1.deleted).to.eql(1);
        expect(o2.deleted).to.eql(1);
        expect(o3.deleted).to.eql(0);
      });
    });
  });
  describe('#containsServiceInstance', () => {
    let sandbox, getAllStub;
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should return true if service instance is in cache', () => {
      getAllStub = sandbox.stub(Etcd3.prototype, 'getAll', () => new MultiRangeStubber(['bosh/deployments/1', 'bosh/deployments/2', 'bosh/tasks/1']));
      return subject.containsServiceInstance('1').then(o => {
        expect(o).to.eql(true);
      });
    });
    it('should return false if service instance is not in cache', () => {
      getAllStub = sandbox.stub(Etcd3.prototype, 'getAll', () => new MultiRangeStubber(['bosh/deployments/1', 'bosh/deployments/2', 'bosh/tasks/3']));
      return subject.containsServiceInstance('3').then(o => {
        expect(o).to.eql(false);
      });
    });
    it('should throw error if operation fails', () => {
      getAllStub = sandbox.stub(Etcd3.prototype, 'getAll', () => new MultiRangeStubber(['bosh/deployments/1', 'bosh/deployments/2', 'bosh/tasks/3'], true));
      return subject.containsServiceInstance('3').catch(err => {
        expect(err.message).to.eql('etcd_error');
      });
    });
  });
});