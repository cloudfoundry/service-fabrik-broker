const _ = require('lodash');
const Promise = require('bluebird');

class BoshBackupStoreStub {

    async getPersistentDisks() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(), 60000)
        });
        return promise;
    }
    
    async stopDeployment() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(), 60000)
        });
        return promise;
    }

    async pollTaskStatusTillComplete() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(), 60000)
        });
        return promise;
    }

    async createDiskFromSnapshot() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(), 60000)
        });
        return promise;
    }

    async createDiskAttachment() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(), 60000)
        });
        return promise;
    }

    async runDeploymentErrand() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(), 60000)
        });
        return promise;
    }

    async startDeployment() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(), 60000)
        });
        return promise;
    }
}

module.exports = BoshBackupStoreStub;