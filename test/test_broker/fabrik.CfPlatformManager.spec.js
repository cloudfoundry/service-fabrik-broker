const Promise = require('bluebird');
const _ = require('lodash');
const CfPlatformManager = require('../../broker/lib/fabrik/CfPlatformManager');
const assert = require('assert');
let config = require('../../broker/lib/config');

describe('fabrik', function(){
    describe('CfPlatformManager', function(){

        let cfPlatformManager = new CfPlatformManager('cf');
        let prevVal = _.get(config, 'feature.EnableSecurityGroupsOps', true);
        let sandbox, createSecurityGroupStub, deleteSecurityGroupStub, ensureSecurityGroupExistsStub;

        before(function(){

            _.set(config, 'feature.EnableSecurityGroupsOps', false);
            sandbox = sinon.sandbox.create();
            createSecurityGroupStub = sandbox.stub(cfPlatformManager, 'createSecurityGroup');
            createSecurityGroupStub
            .withArgs({'dummy': 'dummy'})
            .returns(Promise.try(() => {
                return {'dummy': 'dummy'};
            }));

            deleteSecurityGroupStub = sandbox.stub(cfPlatformManager, 'deleteSecurityGroup');
            deleteSecurityGroupStub
            .withArgs({'dummy': 'dummy'})
            .returns(Promise.try(() => {
                return {'dummy': 'dummy'};
            }));

            ensureSecurityGroupExistsStub = sandbox.stub(cfPlatformManager, 'ensureSecurityGroupExists');
            ensureSecurityGroupExistsStub
            .withArgs({'dummy': 'dummy'})
            .returns(Promise.try(() => {
                return {'dummy': 'dummy'};
            }));

        });
        
        after(function () {
            _.set(config,'feature.EnableSecurityGroupsOps',prevVal);
            sandbox.restore();
        });

        it('should not make call to createSecurityGroup when EnableSecurityGroupsOps set to false', function(){
            return cfPlatformManager
            .postInstanceProvisionOperations({'dummy': 'dummy'})
            .then(() => {
                assert(!createSecurityGroupStub.called);
            });
        });

        it('should not make call to deleteSecurityGroup when EnableSecurityGroupsOps set to false', function(){
            return cfPlatformManager
            .preInstanceDeleteOperations({'dummy': 'dummy'})
            .then(() => {
                assert(!deleteSecurityGroupStub.called);
            });
        });

        it('should not make call to ensureSecurityGroupExists when EnableSecurityGroupsOps set to false', function(){
            return cfPlatformManager
            .postInstanceUpdateOperations({'dummy': 'dummy'})
            .then(() => {
                assert(!ensureSecurityGroupExistsStub.called);
            });
        });
    });
});