const _ = require('lodash');
const Promise = require('bluebird');

class BoshBackupStoreStub {

    async getPersistentDisks() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(
            [
                {
                'job_name': 'blueprint',
                'id': '0',
                'disk_cid': 'random-uuid',
                'az': 'z1'
                }
            ]
            ), 60000)
        });
        return promise;
    }
    
    async stopDeployment() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve('boshStopTaskId'), 60000)
        });
        return promise;
    }

    async pollTaskStatusTillComplete() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve({'result': 'success'}), 60000)
        });
        return promise;
    }

    async createDiskFromSnapshot() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve(
                {
                'volumeId':'random-uuid-1',
                'size': '1GB', 
                'zone': 'z1'
                }
            ), 60000)
        });
        return promise;
    }

    async createDiskAttachment() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve('createDiskAttachmentTaskId'), 60000)
        });
        return promise;
    }

    async runDeploymentErrand() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve('runDeploymentErrandTaskId'), 60000)
        });
        return promise;
    }

    async startDeployment() {
        let promise = new Promise((resolve, reject) => {
            setTimeout(() => resolve('startDeploymentTaskId'), 60000)
        });
        return promise;
    }
}

module.exports = BoshBackupStoreStub;