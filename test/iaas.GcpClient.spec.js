'use strict';

const lib = require('../lib');
const GcpClient = lib.iaas.GcpClient;

describe('iaas', function () {
  describe('GcpClient', function () {

    const config = {
      backup: {
        retention_period_in_days: 14,
        max_num_on_demand_backup: 2,
        status_check_every: 120000, // (ms) Check the status of backup once every 2 mins
        backup_restore_status_poller_timeout: 86400000, // (ms) Deployment backup/restore must finish within this timeout time (24 hrs)
        backup_restore_status_check_every: 120000, // (ms) Check the status of deployment backup/restore once every 2 mins
        abort_time_out: 300000, //(ms) Timeout time for abort of backup to complete
        provider: {
          name: 'gcp',
          projectId: 'my-gcp-dev',
          credentials: {
            'type': 'service_account',
            'project_id': 'my-gcp-dev',
            'private_key_id': 'kkkkkkkk',
            'private_key': '-----BEGIN PRIVATE KEY-----\nlllllllllllllllllllllll\n-----END PRIVATE KEY-----\n',
            'client_email': 'my-test-user@my-gcp-dev.iam.myaccounts.com',
            'client_id': '000000000000000',
            'auth_uri': 'https://myaccounts.com/oauth2/auth',
            'token_uri': 'https://myaccounts.com/oauth2/token',
            'auth_provider_x509_cert_url': 'https://myaccounts.com/oauth2/v1/certs',
            'client_x509_cert_url': 'https://myaccounts.com/v1/metadata/x509/my-test-user%40my-gcp-dev.iam.myaccounts.com'
          },
          container: 'sample-container',
          provider: 'gcp'
        }
      }
    };
    const settings = config.backup.provider;

    describe('#ValidateParams', function () {
      it('should throw an error if config not passed', function () {
        expect(() => GcpClient.validateParams(null)).to.throw();
      });
      it('should throw error if projectId is not provided in config', function () {
        var config = {
          name: 'gcp',
          credentials: {
            'type': 'service_account',
            'project_id': 'my-gcp-dev',
            'private_key_id': 'kkkkkkkk',
            'private_key': '-----BEGIN PRIVATE KEY-----\nlllllllllllllllllllllll\n-----END PRIVATE KEY-----\n',
            'client_email': 'my-test-user@my-gcp-dev.iam.myaccounts.com',
            'client_id': '000000000000000',
            'auth_uri': 'https://myaccounts.com/oauth2/auth',
            'token_uri': 'https://myaccounts.com/oauth2/token',
            'auth_provider_x509_cert_url': 'https://myaccounts.com/oauth2/v1/certs',
            'client_x509_cert_url': 'https://myaccounts.com/v1/metadata/x509/my-test-user%40my-gcp-dev.iam.myaccounts.com'
          }
        };
        expect(() => GcpClient.validateParams(config)).to.throw();
      });
      it('should throw error if credentials are not provided in config', function () {
        var config = {
          name: 'gcp',
          projectId: 'my-project-id'
        };
        expect(() => GcpClient.validateParams(config)).to.throw();
      });
      it('should throw an error if credentials object provided in config is missing any params', function () {
        var config = {
          name: 'gcp',
          projectId: 'my-project-id',
          credentials: {
            'type': 'service_account',
            'project_id': 'my-gcp-dev',
            'private_key_id': 'kkkkkkkk',
            'private_key': '-----BEGIN PRIVATE KEY-----\nlllllllllllllllllllllll\n-----END PRIVATE KEY-----\n',
            'client_email': 'my-test-user@my-gcp-dev.iam.myaccounts.com',
            'client_id': '000000000000000',
            'auth_uri': 'https://myaccounts.com/oauth2/auth',
            'token_uri': 'https://myaccounts.com/oauth2/token',
            'auth_provider_x509_cert_url': 'https://myaccounts.com/oauth2/v1/certs',
            // missing client_x509_cert_url param
          }
        };
        expect(() => GcpClient.validateParams(config)).to.throw();
      });
      it('should return true if projectId and credentials are provided in config', function () {
        expect(GcpClient.validateParams(settings)).to.equal(true);
      });
    });

    describe('#GcpStorage', function () {
      it('should form an object with credentials and projectId with storage base url', function () {
        const responseGcpStorageObject = GcpClient.createStorageClient(settings);
        const baseUrl = 'https://www.googleapis.com/storage/v1';

        expect(responseGcpStorageObject.baseUrl).to.equal(baseUrl);
        expect(responseGcpStorageObject.projectId).to.equal(settings.projectId);
        expect(responseGcpStorageObject.authClient.config.projectId).to.equal(settings.projectId);
        expect(responseGcpStorageObject.authClient.config.credentials).to.eql(settings.credentials);
      });
    });

    describe('#GcpCompute', function () {
      it('should form an object with credentials and projectId with compute base url', function () {
        const responseGcpComputeObject = GcpClient.createComputeClient(settings);
        const baseUrl = 'https://www.googleapis.com/compute/v1';

        expect(responseGcpComputeObject.baseUrl).to.equal(baseUrl);
        expect(responseGcpComputeObject.projectId).to.equal(settings.projectId);
        expect(responseGcpComputeObject.authClient.config.credentials).to.eql(settings.credentials);
      });
    });
  });
});