'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const moment = require('moment');
const ScheduleManager = require('@sf/jobs');
const {
  CONST,
  errors: {
    Forbidden
  },
  commonFunctions: {
    unifyDiffResult
  }
} = require('@sf/common-utils');
const apps = require('../../../../test/test_broker/support/apps');
const {
  catalog,
  Service
} = require('@sf/models');
const config = require('@sf/app-config');
const {
  backupStore,
  cloudProvider,
  CloudProviderClient
} = require('@sf/iaas');
const filename = backupStore.filename;

describe('service-fabrik-api-sf2.0', function () {

  describe('instances', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/api/v1';
      const authHeader = `bearer ${mocks.uaa.jwtToken}`;
      const adminAuthHeader = `bearer ${mocks.uaa.adminJwtToken}`;
      const authHeaderInsufficientScopes = `bearer ${mocks.uaa.jwtTokenInsufficientScopes}`;
      const authHeaderOtherUser = `bearer ${mocks.uaa.jwtTokenOtherUser}`;
      const index = mocks.director.networkSegmentIndex;
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan_guid = '60750c9c-8937-4caf-9e94-c38cbbbfd191';
      const instance_id = mocks.director.uuidByIndex(index);
      const citr_instance_id = 'abcde437-7585-4d75-addf-aa4d46b49e3b';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const organization_guid = 'c84c8e58-eedc-4706-91fb-e8d97b333481';
      const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
      const restore_guid = '2ed8d561-9eb5-11e8-a55f-784f43900dff';
      const time = Date.now();
      const started_at = isoDate(time);
      const timeAfter = moment(time).add(1, 'seconds').toDate();
      const restore_at = new Date(timeAfter).toISOString().replace(/\.\d*/, '');
      const restoreAtEpoch = Date.parse(restore_at);
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const username = 'hugo';
      const container = backupStore.containerName;
      const repeatInterval = '*/1 * * * *';
      const repeatTimezone = 'America/New_York';
      const dummyDeploymentResource = {
        metadata: {
          labels: {
            last_backup_defaultbackups: backup_guid,
            last_restore_defaultrestores: restore_guid
          }
        },
        spec: {
          options: JSON.stringify({
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'cloudfoundry'
            },
            space_guid: space_guid
          })
        }
      };

      const dummyDeploymentResourceAbort = {
        metadata: {
          labels: {
            last_backup_defaultbackups: 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa'
          }
        },
        spec: {
          options: JSON.stringify({
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'cloudfoundry'
            },
            space_guid: space_guid
          })
        }
      };

      const dummyBackupResource = {
        spec: {
          options: {
            context: {
              space_guid: space_guid
            }
          }
        }
      };

      const getJob = (name, type) => {
        return Promise.resolve({
          name: `${instance_id}_${type === undefined ? CONST.JOB.SCHEDULED_BACKUP : type}`,
          repeatInterval: repeatInterval,
          data: {
            instance_id: instance_id,
            type: 'online'
          },
          nextRunAt: time,
          lastRunAt: time,
          lockedAt: null,
          repeatTimezone: repeatTimezone,
          createdAt: time,
          updatedAt: time,
          createdBy: username,
          updatedBy: username
        });
      };
      let scheduleStub, getScheduleStub, cancelScheduleStub, timestampStub;

      function isoDate(time) {
        return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
      }

      before(function () {
        config.mongodb.provision.plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
        backupStore.cloudProvider = new CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        timestampStub = sinon.stub(filename, 'timestamp');
        timestampStub.withArgs().returns(started_at);
        scheduleStub = sinon.stub(ScheduleManager, 'schedule').callsFake(getJob);
        getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule').callsFake(getJob);
        cancelScheduleStub = sinon.stub(ScheduleManager, 'cancelSchedule').callsFake(() => Promise.resolve({}));
        return mocks.setup([
          backupStore.cloudProvider.getContainer()
        ]);
      });

      afterEach(function () {
        timestampStub.resetHistory();
        cancelScheduleStub.resetHistory();
        scheduleStub.resetHistory();
        getScheduleStub.resetHistory();
        mocks.reset();
      });

      after(function () {
        timestampStub.restore();
        backupStore.cloudProvider = cloudProvider;
        cancelScheduleStub.restore();
        scheduleStub.restore();
        getScheduleStub.restore();
        delete config.mongodb.provision.plan_id;
      });

      describe('#state', function () {
        it('should return 200 OK', function () {
          const operational = true;
          const details = {
            number_of_files: 5
          };
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.getState(operational, details);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                operational: operational,
                details: details
              });
              mocks.verify();
            });
        });

        it('should return 403 Forbidden', function () {
          mocks.uaa.tokenKey();
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}`)
            .set('Authorization', authHeaderInsufficientScopes)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              mocks.verify();
            });
        });
      });
      describe('#backup-start', function () {
        const type = 'online';
        const list_prefix = `${space_guid}/backup/${service_id}.${instance_id}`;
        const list_filename = `${list_prefix}.${backup_guid}.${started_at}.json`;
        const list_filename2 = `${list_prefix}.${backup_guid}.${isoDate(time + 1)}.json`;
        const list_pathname = `/${container}/${list_filename}`;
        const list_pathname2 = `/${container}/${list_filename2}`;
        const data = {
          trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
          state: 'succeeded',
          agent_ip: mocks.agent.ip
        };
        afterEach(function () {
          mocks.reset();
        });
        it('should initiate a start-backup with SF2.0 not via cloud controller', function (done) {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, list_prefix, [
            list_filename
          ]);
          mocks.cloudProvider.download(list_pathname, data);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'backup'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id
              })
            }
          }, 2);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {});
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .send({
              type: type
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
              done();
            });
        });


        it('should fail start-backup with SF2.0 not via cloud controller with unlocking', function (done) {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, list_prefix, [
            list_filename
          ]);
          mocks.cloudProvider.download(list_pathname, data);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'backup'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          }, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id
              })
            }
          }, 2);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {}, 1, undefined, 404);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .send({
              type: type
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(404);
              mocks.verify();
              done();
            });
        });

        it('should fail if resource could not be fetched from ApiServer and request does not contain plan_id', function (done) {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, 404);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .send({
              type: type,
              space_guid: space_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
              done();
            });
        });

        it('should fail if resource could not be fetched from ApiServer and request does not contain space_guid', function (done) {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, 404);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .send({
              type: type
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
              done();
            });
        });

        it('should initiate a start-backup operation with optional space_guid', function (done) {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, list_prefix, [
            list_filename
          ]);
          mocks.cloudProvider.download(list_pathname, data);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'backup'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id
              })
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .send({
              type: type,
              space_guid: space_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
              done();
            });
        });

        it('should initiate a start-backup operation with context', function (done) {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, list_prefix, [
            list_filename
          ]);
          mocks.cloudProvider.download(list_pathname, data);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'backup'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {});
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id
              })
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .send({
              type: type,
              context: {
                platform: 'cloudfoundry',
                space_guid: space_guid
              }
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
              done();
            });
        });

        it('should recieve 403 forbidden on reaching quota of on-demand backups', function () {
          mocks.uaa.tokenKey();
          mocks.cloudProvider.list(container, list_prefix, [
            list_filename,
            list_filename2
          ]);
          mocks.cloudProvider.download(list_pathname, data);
          mocks.cloudProvider.download(list_pathname2, data);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id
              })
            }
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: type
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              expect(res.body.description).to.eql(`Reached max quota of ${config.backup.max_num_on_demand_backup} ${CONST.BACKUP.TRIGGER.ON_DEMAND} backups`);
              mocks.verify();
            });
        });

        it('should recieve 403 forbidden for trying to trigger scheduled backup', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id
              })
            }
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: type,
              trigger: CONST.BACKUP.TRIGGER.SCHEDULED
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              expect(res.body.description).to.eql('Scheduled backups can only be initiated by the System User');
              mocks.verify();
            });
        });

        it('should initiate a scheduled backup operation when initiated by cf admin user', function () {
          mocks.uaa.tokenKey();
          // cloud controller admin check will ensure getSpaceDeveloper isnt called, so no need to set that mock.
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: JSON.stringify({
                lockedResourceDetails: {
                  operation: 'backup'
                }
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            metadata: {
              resourceVersion: 10
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id
              })
            }
          }, 2);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {});
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});

          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', adminAuthHeader)
            .set('Accept', 'application/json')
            .send({
              type: type,
              trigger: CONST.BACKUP.TRIGGER.SCHEDULED
            })
            .catch(err => err.response)
            .then(res => Promise.delay(20).then(() => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            }));
        });

        // TODO
        // it.only('should initiate a  backup operation & if a backup is already in progress then it must result in DeploymentAlready locked message', function () {
        //   mocks.uaa.tokenKey();
        //   mocks.cloudController.getServiceInstance(instance_id, {
        //     space_guid: space_guid,
        //     service_plan_guid: plan_guid
        //   });
        //   mocks.cloudController.findServicePlan(instance_id, plan_id);
        //   //cloud controller admin check will ensure getSpaceDeveloper isnt called, so no need to set that mock.
        //   const SERVER_ERROR_CODE = 502;
        //   const LOCK_MESSAGE = 'Deployment service-fabrik-0315-b9bf180e-1a67-48b6-9cad-32bd2e936849 __Locked__ by admin at Wed Oct 11 2017 04:09:38 GMT+0000 (UTC) for on-demand_backup';
        //   const error_response_body = {
        //     description: `The service broker rejected the request to ${base_url}/service_instances/b9bf180e-1a67-48b6-9cad-32bd2e936849?accepts_incomplete=true.
        //     Status Code: 422 Unprocessable Entity, Body: {"status":422,"message":"${LOCK_MESSAGE}"}`,
        //     error_code: 'CF-ServiceBrokerRequestRejected',
        //     code: 10001,
        //     http: {
        //       uri: `${base_url}/service_instances/b9bf180e-1a67-48b6-9cad-32bd2e936849?accepts_incomplete=true`,
        //       method: 'PATCH',
        //       status: 422
        //     }
        //   };

        //   mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
        //     spec: {
        //       options: '{}'
        //     }
        //   });
        //   mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {});
        //   mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {});
        //   mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id);
        //   mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
        //   mocks.apiServerEventMesh.nockGetResourceRegex('backup', 'defaultbackup', {
        //     status: {
        //       state: 'in_progress'
        //     }
        //   });
        //   mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {
        //     status: {
        //       response: '{"guid": "some_guid"}'
        //     }
        //   });

        //   return chai
        //     .request(apps.external)
        //     .post(`${base_url}/service_instances/${instance_id}/backup`)
        //     .set('Authorization', adminAuthHeader)
        //     .set('Accept', 'application/json')
        //     .send({
        //       type: type,
        //       trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        //     })
        //     .then(() => {
        //       throw new Error('Should throw error');
        //     })
        //     .catch(err => {
        //       mocks.verify();
        //       expect(_.get(err, 'response.body.status')).to.equal(error_response_body.http.status);
        //       expect(_.get(err, 'response.body.description')).to.equal(LOCK_MESSAGE);
        //     });
        // });
      });

      describe('#backup-state', function () {
        const data = {
          trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
          state: 'processing',
          agent_ip: mocks.agent.ip
        };
        const backupState = {
          state: 'processing',
          stage: 'Deleting volume',
          updated_at: new Date(Date.now())
        };

        it('should return 200 Ok - backup state is retrieved from agent while in \'processing\' state', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            status: {
              response: JSON.stringify(_.chain(backupState)
                .omit('updated_at')
                .assign({
                  trigger: 'on-demand'
                }))
            }
          });
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .query({
              no_cache: true
            })
            .catch(err => err.response)
            .then(res => {
              const result = _
                .chain(data)
                .omit('agent_ip')
                .merge(_.pick(backupState, 'state', 'stage'))
                .value();
              expect(res).to.have.status(200);
              expect(res.body).to.eql(result);
              mocks.verify();
            });
        });

        it('should return 200 Ok - backup state retrieved from meta information itself even when in-processing state', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            status: {
              response: JSON.stringify(data)
            }
          });
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              const result = _
                .chain(data)
                .omit('agent_ip')
                .value();
              expect(res).to.have.status(200);
              expect(res.body).to.eql(result);
              mocks.verify();
            });
        });

        it('should return 200 Ok - backup state retrieved from meta information with space_guid', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            status: {
              response: JSON.stringify(data)
            }
          });
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .query({
              space_guid: space_guid
            })
            .catch(err => err.response)
            .then(res => {
              const result = _
                .chain(data)
                .omit('agent_ip')
                .value();
              expect(res).to.have.status(200);
              expect(res.body).to.eql(result);
              mocks.verify();
            });
        });

        it('should return 200 Ok - backup state retrieved from meta information with platform and tenant_id', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            status: {
              response: JSON.stringify(data)
            }
          });
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .query({
              platform: 'cloudfoundry',
              tenant_id: space_guid
            })
            .catch(err => err.response)
            .then(res => {
              const result = _
                .chain(data)
                .omit('agent_ip')
                .value();
              expect(res).to.have.status(200);
              expect(res.body).to.eql(result);
              mocks.verify();
            });
        });

        it('should return 404  - if last backup label is not set in deployment resource', function () {
          const expectedResponse = {
            "description": `No backup found for service instance \'${instance_id}\'`,
            "error": "Not Found",
            "status": 404
          };
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                service_id: service_id,
                plan_id: plan_id,
                context: {
                  platform: 'cloudfoundry'
                },
                space_guid: space_guid
              })
            }
          }, 2);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .query({
              space_guid: space_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(404);
              expect(_.omit(res.body, 'stack')).to.eql(expectedResponse);
              mocks.verify();
            });
        });

        it('should return 404 if Not Found in apiserver', function () {
          const expectedResponse = {
            "description": `No backup found for service instance \'${instance_id}\'`,
            "error": "Not Found",
            "status": 404
          };
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            status: {
              response: JSON.stringify(data)
            }
          }, 1, 404);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .query({
              space_guid: space_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(404);
              expect(_.omit(res.body, 'stack')).to.eql(expectedResponse);
              mocks.verify();
            });
        });

      });

      describe('#backup-abort', function () {
        let sandbox, delayStub;
        before(function () {
          sandbox = sinon.createSandbox();
          delayStub = sandbox.stub(Promise, 'delay').callsFake(() => Promise.resolve(true));
        });

        after(function () {
          delayStub.restore();
        });
        it('should return 202 Accepted', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResourceAbort, 2);
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {
            status: {
              state: 'in_progress',
              response: '{"guid": "some_guid"}'
            }
          });
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {
            status: {
              state: 'aborting',
              response: '{"guid": "some_guid"}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa', {});
          return chai
            .request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              mocks.verify();
              expect(res).to.have.status(202);
              expect(res.body).to.be.empty;
            });
        });
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResourceAbort, 2);
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {
            status: {
              state: 'in_progress',
              response: '{"guid": "some_guid"}'
            }
          });
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {
            status: {
              state: 'aborted',
              response: '{"guid": "some_guid"}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa', {});
          return chai
            .request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.be.empty;
              mocks.verify();
            });
        });
        it('should return skip abort if state is not "in_progress"', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResourceAbort, 2);
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {
            status: {
              state: 'succeeded',
              response: '{"guid": "some_guid"}'
            }
          });
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, {
            status: {
              state: 'aborted',
              response: '{"guid": "some_guid"}'
            }
          });
          return chai
            .request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.be.empty;
              mocks.verify();
            });
        });
      });

      describe('#non-pitr-services:', function () {
        const indexOfService = _.findIndex(config.services, service => service.pitr === true);
        let getServiceStub;
        before(function () {
          config.services[indexOfService].pitr = false;
          getServiceStub = sinon.stub(catalog, 'getService');
          getServiceStub.withArgs(config.services[indexOfService].id).returns(new Service(config.services[indexOfService]));
        });
        after(function () {
          config.services[indexOfService].pitr = true;
        });
        this.afterEach(function () {
          getServiceStub.restore();
        });
        it('Bad Request at start-restore with time_stamp operation for non PITR service', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.text).to.have.string('Time based recovery not supported for service blueprint');
              expect(getServiceStub.callCount).to.be.eql(1);
              mocks.verify();
            });
        });
      });

      describe('#restore-start', function () {
        const restorePrefix = `${space_guid}/restore/${service_id}.${instance_id}`;
        const backupPrefix = `${space_guid}/backup`;
        const backupPrefix1 = `${backupPrefix}/${service_id}.${instance_id}`;
        const citrBackupPrefix1 = `${backupPrefix}/${service_id}.${citr_instance_id}`;
        const restoreFilename = `${restorePrefix}.json`;
        const backupFilename = `${backupPrefix}/${service_id}.${instance_id}.${backup_guid}.${started_at}.json`;
        const citrBackupFilename = `${backupPrefix}/${service_id}.${citr_instance_id}.${backup_guid}.${started_at}.json`;
        const restorePathname = `/${container}/${restoreFilename}`;
        const backupPathname = `/${container}/${backupFilename}`;
        const citrBackupPathname = `/${container}/${citrBackupFilename}`;
        const backupMetadata = {
          plan_id: plan_id,
          service_id: service_id,
          state: 'succeeded',
          type: 'online',
          secret: 'hugo',
          started_at: started_at
        };
        const restoreMetadata = {
          plan_id: plan_id,
          state: 'succeeded',
          type: 'online',
          secret: 'hugo',
          started_at: started_at,
          trigger: 'online',
          restore_dates: {
            succeeded: [moment(time).subtract(2, 'days').toDate().toISOString(), moment(time).subtract(40, 'days').toDate().toISOString()]
          }
        };

        function getDateHistory(days) {
          let restoreHistory = [];
          for (let i = 1; i <= days; i++) {
            restoreHistory.push(moment(time).subtract(i, 'days').toDate().toISOString());
          }
          return {
            succeeded: restoreHistory
          };
        }

        it('should return 400 Bad Request (no backup_guid or time_stamp given)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        it('should return 400 Bad Request (invalid backup_guid given)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: 'invalid-guid'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        it('should return 400 Bad Request (invalid time_stamp format given)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: '2017-12-04T07:56:02.203Z' // should be epoch
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        it('should return 400 Bad Request (invalid time_stamp older than 14 days given)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          const requestTimeStamp = `${Date.now() - (config.backup.retention_period_in_days + 2) * 60 * 60 * 24 * 1000}`;
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: requestTimeStamp
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.text).to.contain(`Date '${requestTimeStamp}' is not epoch milliseconds or out of range of ${config.backup.retention_period_in_days} days.`);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (no backup with this guid found)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {}, 1, 404);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: backup_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (no backup found before given time_stamp)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, []);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (no backup found before given time_stamp - Cross instance restore)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, citrBackupPrefix1, []);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: `${restoreAtEpoch}`,
              source_instance_id: citr_instance_id
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (backup still in progress)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, dummyBackupResource);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          mocks.cloudProvider.list(container, backupPrefix, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            state: 'processing'
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: backup_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity PITR based (backup still in progress)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            state: 'processing'
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (plan ids do not match)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, dummyBackupResource);
          mocks.cloudProvider.list(container, backupPrefix, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073e',
            state: 'succeeded',
            type: 'online',
            secret: 'hugo',
            started_at: started_at
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: backup_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity PITR based (plan ids do not match)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073e',
            state: 'succeeded',
            type: 'online',
            secret: 'hugo',
            started_at: started_at
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 400 BadRequest : backup_guid based (quota exceeded)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, dummyBackupResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.download(restorePathname, _.chain(_.cloneDeep(restoreMetadata))
            .set('restore_dates', getDateHistory(11))
            .value());
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              backup_guid: backup_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        it('should return 400 BadRequest : PITR (quota exceeded)', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.download(restorePathname, _.assign(_.cloneDeep(restoreMetadata), {
            restore_dates: getDateHistory(11)
          }));
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        const backup_create_response = {
          'metadata': {
            'name': backup_guid
          },
          'spec': {
            'options': JSON.stringify({
              'plan_id': plan_id,
              'service_id': service_id,
              'context': {
                'space_guid': space_guid,
                'platform': 'cloudfoundry'
              },
              'instance_guid': instance_id,
              'deployment': {
                'isFulfilled': false,
                'isRejected': false
              },
              'arguments': {
                'backup': {
                  'type': 'online',
                  'secret': 'hugo'
                }
              }
            })
          }
        };
        const lock_body = {
          'metadata': {
            'name': instance_id
          },
          'spec': {
            'options': JSON.stringify({
              'lockedResourceDetails': {
                'resourceGroup': 'backup.servicefabrik.io',
                'resourceType': 'defaultbackups',
                'resourceId': {
                  'isFulfilled': true,
                  'isRejected': false,
                  'fulfillmentValue': 'eeb83f57-ee6b-4c46-a4da-a06741dc0436'
                },
                'operation': 'restore'
              },
              'lockType': 'WRITE',
              'lockTTL': null,
              'lockTime': '2018-08-12T14:51:27.510Z'
            })
          }
        };

        it('should initiate a start-restore operation via apiserver', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, backupMetadata);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, dummyBackupResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, lock_body);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, backup_create_response);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                space_guid: space_guid,
                plan_id: plan_id
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              backup_guid: backup_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should initiate a start-restore operation via apiserver:PITR', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, backupMetadata);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                space_guid: space_guid,
                plan_id: plan_id
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, lock_body);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, backup_create_response);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should initiate a start-restore operation via apiserver :PITR (within quota)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, backupMetadata);
          mocks.cloudProvider.download(restorePathname, restoreMetadata);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                space_guid: space_guid,
                plan_id: plan_id
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, lock_body);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, backup_create_response);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should initiate a start-restore operation via apiserver:PITR (within quota - no history)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, backupMetadata);
          mocks.cloudProvider.download(restorePathname, _.assign(_.cloneDeep(restoreMetadata), {
            restore_dates: undefined
          }));
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                space_guid: space_guid,
                plan_id: plan_id
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, lock_body);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, backup_create_response);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              time_stamp: `${restoreAtEpoch}`
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should initiate a start-restore operation at cloud controller via a service instance update: PITR - Cross Instance restore', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, citrBackupPrefix1, [citrBackupFilename]);
          mocks.cloudProvider.download(citrBackupPathname, backupMetadata);
          mocks.cloudProvider.download(restorePathname, restoreMetadata);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, lock_body);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, backup_create_response);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                space_guid: space_guid,
                plan_id: plan_id
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              time_stamp: `${restoreAtEpoch}`,
              source_instance_id: citr_instance_id
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should initiate a start-restore operation for cross-space restore -- Non PITR case', function () {
          let destination_space_guid = 'a17aa19e-9919-4cfe-a2b7-13f4312b6f94';
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudController.getSpaceDevelopers(destination_space_guid);
          mocks.cloudProvider.list(container, backupPrefix, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, backupMetadata);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, {
            spec: {
              options: '{}'
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, dummyBackupResource);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, instance_id, lock_body);
          mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, backup_create_response);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: destination_space_guid,
                  organization_guid: organization_guid
                },
                space_guid: destination_space_guid,
                plan_id: plan_id
              })
            }
          });
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {});
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              backup_guid: backup_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should not initiate start-restore operation for cross-space restore if user not SpaceDeveloper in source space', function () {
          let destination_space_guid = 'a17aa19e-9919-4cfe-a2b7-13f4312b6f94';
          let otherUser = 'otherUser'; // to validate space developer permission checks
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudController.getSpaceDevelopers(destination_space_guid, otherUser);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, dummyBackupResource);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: destination_space_guid,
                  organization_guid: organization_guid
                },
                space_guid: destination_space_guid,
                plan_id: plan_id
              })
            }
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeaderOtherUser)
            .send({
              backup_guid: backup_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              mocks.verify();
            });
        });
      });

      describe('#restore-state', function () {
        // const prefix = `${space_guid}/restore/${service_id}.${instance_id}`;
        // const filename = `${prefix}.json`;
        // const pathname = `/${container}/${filename}`;
        // const data = {
        //   state: 'processing',
        //   agent_ip: mocks.agent.ip
        // };
        const restoreState = {
          state: 'processing',
          stage: 'Downloading tarball',
          updated_at: new Date(Date.now())
        };

        it('should return 200 Ok', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          // mocks.cloudProvider.download(pathname, data);
          // mocks.agent.lastRestoreOperation(restoreState);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, restore_guid, {
            status: {
              response: JSON.stringify(restoreState)
            }
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.state).to.eql(restoreState.state);
              mocks.verify();
            });
        });

        it('should return 404 Not Found', function () {
          const expectedResponse = {
            "description": `No restore found for service instance \'${instance_id}\'`,
            "error": "Not Found",
            "status": 404
          };
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource, 2);
          mocks.serviceBrokerClient.getConfigValue(undefined, 'disable_bosh_based_restore_blueprint', false);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(404);
              expect(_.omit(res.body, 'stack')).to.eql(expectedResponse);
              mocks.verify();
            });
        });
      });

      describe('#restore-abort', function () {
        // const prefix = `${space_guid}/restore/${service_id}.${instance_id}`;
        // const filename = `${prefix}.json`;
        // const pathname = `/${container}/${filename}`;
        // const data = {
        //   state: 'processing',
        //   agent_ip: mocks.agent.ip
        // };
        let sandbox, delayStub;
        const directorResourceAbort = {
          metadata: {
            labels: {}
          },
          spec: {
            options: JSON.stringify({
              service_id: service_id,
              plan_id: plan_id,
              context: {
                platform: 'cloudfoundry'
              },
              space_guid: space_guid
            })
          }
        };
        before(function () {
          sandbox = sinon.createSandbox();
          delayStub = sandbox.stub(Promise, 'delay').callsFake(() => Promise.resolve(true));
        });

        after(function () {
          delayStub.restore();
        });
        it('should return 202 Accepted', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          directorResourceAbort.metadata.labels[`last_${CONST.OPERATION_TYPE.RESTORE}_${CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE}`] = restore_guid;
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, directorResourceAbort, 2);
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
            status: {
              state: CONST.RESTORE_OPERATION.PROCESSING,
              response: '{"guid": "some_guid"}'
            }
          });
          mocks.apiServerEventMesh.nockPatchResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {});
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
            status: {
              state: CONST.OPERATION.ABORTING,
              response: '{"guid": "some_guid"}'
            }
          });
          return chai
            .request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.be.empty;
              mocks.verify();
            });
        });
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          directorResourceAbort.metadata.labels[`last_${CONST.OPERATION_TYPE.RESTORE}_${CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE}`] = restore_guid;
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            instance_id, directorResourceAbort, 2);
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
            status: {
              state: 'succeeded',
              response: '{"guid": "some_guid"}'
            }
          });
          mocks.apiServerEventMesh.nockGetResourceRegex(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, {
            status: {
              state: 'succeeded',
              response: '{"guid": "some_guid"}'
            }
          });
          return chai
            .request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.be.empty;
              mocks.verify();
            });
        });
      });

      describe('#listLastBackups', function () {
        const prefix = `${space_guid}/backup/${service_id}`;
        const filename1 = `${prefix}.${instance_id}.${backup_guid}.${started_at}.json`;
        const filename2 = `${prefix}.${instance_id}.${backup_guid}.${isoDate(time + 1)}.json`;
        const filename3 = `${prefix}.${instance_id}.${backup_guid}.${isoDate(time + 2)}.json`;
        const pathname3 = `/${container}/${filename3}`;
        const data = {
          trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
          state: 'processing',
          agent_ip: mocks.agent.ip,
          logs: []
        };

        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [
            filename1,
            filename2,
            filename3
          ]);
          mocks.cloudProvider.download(pathname3, data);
          return chai
            .request(apps.external)
            .get(`${base_url}/service_instances/backup`)
            .query({
              space_guid: space_guid,
              service_id: service_id
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data, 'agent_ip', 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });
      });

      describe('#listLastRestores', function () {
        const instance_id2 = 'fff659f7-3fb4-4034-aaf3-ab103698f6b0';
        const prefix = `${space_guid}/restore/${service_id}`;
        const filename1 = `${prefix}.${instance_id}.json`;
        const filename2 = `${prefix}.${instance_id2}.json`;
        const pathname1 = `/${container}/${filename1}`;
        const pathname2 = `/${container}/${filename2}`;
        const data = {
          state: 'processing',
          agent_ip: mocks.agent.ip,
          logs: []
        };

        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [
            filename1,
            filename2
          ]);
          mocks.cloudProvider.download(pathname1, data);
          mocks.cloudProvider.download(pathname2, data);
          return chai
            .request(apps.external)
            .get(`${base_url}/service_instances/restore`)
            .query({
              space_guid: space_guid,
              service_id: service_id
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = _.omit(data, 'agent_ip', 'logs');
              expect(res.body).to.eql([
                body,
                body
              ]);
              mocks.verify();
            });
        });
      });

      describe('#backup-delete', function () {
        const data = {
          trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
          state: 'succeeded',
          backup_guid: backup_guid,
          agent_ip: mocks.agent.ip,
          service_id: service_id
        };
        let sandbox, delayStub;
        before(function () {
          sandbox = sinon.createSandbox();
          delayStub = sandbox.stub(Promise, 'delay').callsFake(() => Promise.resolve(true));
        });

        after(function () {
          delayStub.restore();
        });
        it('should return 200 for an on-demand backup', function () {
          mocks.uaa.tokenKey();
          // cloud controller admin check will ensure getSpaceDeveloper isnt called, so no need to set that mock.
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid);
          return chai.request(apps.external)
            .delete(`${base_url}/backups/${backup_guid}?space_guid=${space_guid}`)
            .set('Authorization', adminAuthHeader)
            .set('Accept', 'application/json')
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it(`should return 403 for a scheduled backup within ${config.backup.retention_period_in_days} days`, function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED,
              error: JSON.stringify(new Forbidden('Delete of scheduled backup not permitted within retention period of 14 days'))
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {});
          return chai.request(apps.external)
            .delete(`${base_url}/backups/${backup_guid}?space_guid=${space_guid}`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              expect(res.body.description).to.eql(`Delete of scheduled backup not permitted within retention period of ${config.backup.retention_period_in_days} days`);
              mocks.verify();
            });
        });

        it(`should return 200 for a scheduled backup After ${config.backup.retention_period_in_days} days`, function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {
            spec: {
              options: JSON.stringify(data)
            },
            status: {
              state: 'deleted',
              response: '{}'
            }
          }, 2);
          mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid, {});
          mocks.apiServerEventMesh.nockDeleteResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, backup_guid);
          return chai.request(apps.external)
            .delete(`${base_url}/backups/${backup_guid}?space_guid=${space_guid}`)
            .set('Authorization', adminAuthHeader)
            .set('Accept', 'application/json')
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });

      describe('#backup-schedule', function () {
        it('should return 503 - schedule backup feature not enabled', function () {
          const mongourl = config.mongodb.url;
          const mongoprovision = config.mongodb.provision;
          delete config.mongodb.url;
          delete config.mongodb.provision;
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_BACKUP} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongoprovision;
              mocks.verify();
            });
        });

        it('should return 400 - Bad request on skipping mandatory params', function () {
          const expectedResponse = {
            "description": "repeatInterval | type are mandatory",
            "error": "Bad Request",
            "status": 400
          };
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .send({})
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(_.omit(res.body, 'stack')).to.eql(expectedResponse);
              mocks.verify();
            });
        });

        it('should return 201 OK', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpace(space_guid, organization_guid);
          mocks.cloudController.getOrganization(organization_guid);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob().value());
              mocks.verify();
            });
        });

        it('should return 201 OK for k8s platform instances', function () {
          /* This test case represents an intermediate situation: although instance originates from k8s platform,
          auth is being done using CF UAA. This will not be situation in the landscape most probably, however test case
          serves the purpose of verifying rest of the operation (post auth).  
          */
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                service_id: service_id,
                plan_id: plan_id,
                context: {
                  platform: 'sapcp',
                  origin: 'kubernetes'
                },
                space_guid: space_guid
              })
            }
          });
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob().value());
              mocks.verify();
            });
        });
      });

      describe('#GetBackupSchedule', function () {
        it('should return 503 - schedule backup feature not enabled', function () {
          const mongourl = config.mongodb.url;
          delete config.mongodb.url;
          const mongodbprovision = config.mongodb.provision;
          mocks.uaa.tokenKey();
          delete config.mongodb.provision;
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .set('accept', 'application/json')
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_BACKUP} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongodbprovision;
              mocks.verify();
            });
        });
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(getJob().value());
              mocks.verify();
            });
        });
      });

      describe('#CancelBackupSchedule', function () {
        it('should return 503 - schedule backup feature not enabled', function () {
          const mongourl = config.mongodb.url;
          const mongoprovision = config.mongodb.provision;
          delete config.mongodb.url;
          delete config.mongodb.provision;
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .set('accept', 'application/json')
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_BACKUP} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongoprovision;
              mocks.verify();
            });
        });
        it('should return 403 Forbidden if not admin', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(cancelScheduleStub).to.be.not.called;
              expect(res).to.have.status(403);
              mocks.verify();
            });
        });
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          return chai.request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', adminAuthHeader)
            .catch(err => err.response)
            .then(res => {
              expect(cancelScheduleStub).to.be.calledOnce;
              expect(cancelScheduleStub.firstCall.args[0]).to.eql(instance_id);
              expect(cancelScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });

      describe('#schedule-update', function () {
        it('should return 503 - schedule update feature not enabled', function () {
          const mongourl = config.mongodb.url;
          const mongoprovision = config.mongodb.provision;
          delete config.mongodb.url;
          delete config.mongodb.provision;
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_UPDATE} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongoprovision;
              mocks.verify();
            });
        });

        it('should return 400 - Badrequest on skipping mandatory params', function () {
          const expectedResponse = {
            "description": "repeatInterval is mandatory",
            "error": "Bad Request",
            "status": 400
          };
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .send({})
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(_.omit(res.body, 'stack')).to.eql(expectedResponse);
              mocks.verify();
            });
        });

        it('should return 201 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.director.getDeployments();
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value());
              mocks.verify();
            });
        });

        it('should return 201 OK for k8s platform instances', function () {
          /* This test case represents an intermediate situation: although instance originates from k8s platform,
          auth is being done using CF UAA. This will not be situation in the landscape most probably, however test case
          serves the purpose of verifying rest of the operation (post auth).  
          */
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                service_id: service_id,
                plan_id: plan_id,
                context: {
                  platform: 'sapcp',
                  origin: 'kubernetes'
                },
                space_guid: space_guid
              })
            }
          });
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.director.getDeployments();
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value());
              mocks.verify();
            });
        });

        it('should return 201 OK - when rate limiting against bosh is explicitly not required', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.director.getDeployments();
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *',
              runImmediately: 'true'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value());
              mocks.verify();
            });
        });
      });

      describe('#GetUpdateSchedule', function () {
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value());
              mocks.verify();
            });
        });
        it('should return update required status if query param check_update_required is provided', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {
            spec: {
              options: JSON.stringify({
                context: {
                  platform: CONST.PLATFORM.CF,
                  space_guid: space_guid,
                  organization_guid: organization_guid
                },
                plan_id: plan_id,
                space_guid: space_guid
              })
            }
          }, 2);
          mocks.director.getDeployments();
          mocks.director.getDeployment(deploymentName, true);
          const diff = [
            ['- name: blueprint', null],
            ['  version: 0.0.10', 'removed'],
            ['  version: 0.0.11', 'added']
          ];
          mocks.director.diffDeploymentManifest(1, diff);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .query({
              check_update_required: true
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const expectedJobResponse = getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value();
              _.set(expectedJobResponse, 'update_required', true);
              _.set(expectedJobResponse, 'update_details', unifyDiffResult({
                diff: diff
              }));
              expect(res.body).to.eql(expectedJobResponse);
              mocks.verify();
            });
        });
      });

      describe('#CancelUpdateSchedule', function () {
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          return chai.request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', adminAuthHeader)
            .catch(err => err.response)
            .then(res => {
              expect(cancelScheduleStub).to.be.calledOnce;
              expect(cancelScheduleStub.firstCall.args[0]).to.eql(instance_id);
              expect(cancelScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
              expect(cancelScheduleStub.firstCall.args[2]).to.eql(true);
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
        it('should return 403 Forbidden if not admin', function () {
          mocks.uaa.tokenKey();
          mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(cancelScheduleStub).to.be.not.called;
              expect(res).to.have.status(403);
              mocks.verify();
            });
        });
      });
    });
  });
});
