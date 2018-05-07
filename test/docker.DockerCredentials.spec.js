'use strict';

const _ = require('lodash');
const DockerCredentials = require('../broker/lib/docker/DockerCredentials');

describe('docker', function () {
  describe('DockerCredentials', function () {
    /* jshint expr:true */
    const username = {
      key: 'USERNAME'
    };
    const password = {
      key: 'PASSWORD'
    };
    const dbname = {
      key: 'DBNAME'
    };
    const uri = {
      prefix: 'http',
      port: '1234/tcp'
    };
    const base64Random = [
      '0RFgh5lLx827Bp1+',
      'wAgI6vrObleCJCLa',
      'N3bnHyZ84Z8o/RLf'
    ];
    const environment = {
      USERNAME: 'R0Fgh5lLx827Bp1-',
      PASSWORD: 'wAgI6vrObleCJCLa',
      DBNAME: 'N3bnHyZ84Z8o_RLf'
    };

    let randomBytesStub;

    function randomBytes(i) {
      return Promise.resolve(new Buffer(base64Random[i], 'base64'));
    }

    function createCredentials(options) {
      return new DockerCredentials(_.merge({}, {
        username: username,
        password: password,
        uri: uri,
        dbname: dbname
      }, options));
    }

    beforeEach(function () {
      randomBytesStub = sinon.stub(DockerCredentials, 'randomBytes');
      randomBytesStub.onCall(0).returns(randomBytes(0));
      randomBytesStub.onCall(1).returns(randomBytes(1));
      randomBytesStub.onCall(2).returns(randomBytes(2));
      randomBytesStub.returns(undefined);
    });

    afterEach(function () {
      randomBytesStub.restore();
    });

    describe('#constructor', function () {
      it('should create credentials with empty properties', function () {
        const dockerCredentials = new DockerCredentials();
        expect(dockerCredentials.username).to.eql({});
        expect(dockerCredentials.password).to.eql({});
        expect(dockerCredentials.dbname).to.eql({});
        expect(dockerCredentials.uri).to.eql({});
      });
      it('should create credentials with an empty username object', function () {
        const dockerCredentials = createCredentials({
          username: null
        });
        expect(dockerCredentials.username).to.eql({});
      });
      it('should create credentials with an empty password object', function () {
        const dockerCredentials = createCredentials({
          password: null
        });
        expect(dockerCredentials.password).to.eql({});
      });
      it('should create credentials with an empty dbname object', function () {
        const dockerCredentials = createCredentials({
          dbname: null
        });
        expect(dockerCredentials.dbname).to.eql({});
      });
      it('should create credentials with an empty uri object', function () {
        const dockerCredentials = createCredentials({
          uri: null
        });
        expect(dockerCredentials.uri).to.eql({});
      });
    });

    describe('#randomString', function () {
      it('should return url-safe base64 random strings starting with a letter', function () {
        const dockerCredentials = createCredentials();
        return Promise
          .all([
            dockerCredentials.randomString(),
            dockerCredentials.randomString(),
            dockerCredentials.randomString()
          ])
          .then(values => {
            expect(randomBytesStub).to.have.been.calledThrice;
            expect(randomBytesStub.alwaysCalledWithExactly(12)).to.be.true;
            expect(values).to.eql(_.values(environment));
          });
      });
    });

    describe('#usernameKey', function () {
      it('should return the usernameKey "USERNAME"', function () {
        const dockerCredentials = createCredentials();
        expect(dockerCredentials.usernameKey).to.equal('USERNAME');
      });
    });

    describe('#passwordKey', function () {
      it('should return the passwordKey "PASSWORD"', function () {
        const dockerCredentials = createCredentials();
        expect(dockerCredentials.passwordKey).to.equal('PASSWORD');
      });
    });

    describe('#dbnameKey', function () {
      it('should return the dbnameKey "DBNAME"', function () {
        const dockerCredentials = createCredentials();
        expect(dockerCredentials.dbnameKey).to.equal('DBNAME');
      });
    });

    describe('#usernameValue', function () {
      it('should return a random string', function () {
        const dockerCredentials = createCredentials();
        return Promise
          .try(() => dockerCredentials.usernameValue)
          .then(value => {
            expect(value).to.equal(environment.USERNAME);
          });
      });

      it('should return a pre-defined string', function () {
        const dockerCredentials = createCredentials({
          username: {
            value: 'admin'
          }
        });
        return Promise
          .try(() => {
            return dockerCredentials.usernameValue;
          })
          .then(value => {
            expect(value).to.equal('admin');
          });
      });
    });

    describe('#passwordValue', function () {
      it('should return a random string', function () {
        const dockerCredentials = createCredentials();
        return Promise
          .try(() => dockerCredentials
            .createEnvironment()
            .then(env => env.PASSWORD)
          )
          .then(value => {
            expect(value).to.equal(environment.PASSWORD);
          });
      });

      it('should return a pre-defined string', function () {
        const dockerCredentials = createCredentials({
          password: {
            value: 'secret'
          }
        });
        return Promise
          .try(() => dockerCredentials.passwordValue)
          .then(value => {
            expect(value).to.equal('secret');
          });
      });
    });

    describe('#dbnameValue', function () {
      it('should return a random string', function () {
        const dockerCredentials = createCredentials();
        return Promise
          .try(() => dockerCredentials
            .createEnvironment()
            .then(env => env.DBNAME)
          )
          .then(value => {
            expect(value).to.equal(environment.DBNAME);
          });
      });

      it('should return a pre-defined string', function () {
        const dockerCredentials = createCredentials({
          dbname: {
            value: 'mydb'
          }
        });
        return Promise
          .try(() => dockerCredentials.dbnameValue)
          .then(value => {
            expect(value).to.equal('mydb');
          });
      });
    });

    describe('#uriPrefix', function () {
      it('returns http', function () {
        const dockerCredentials = createCredentials();
        expect(dockerCredentials.uriPrefix).to.equal('http');
      });
    });

    describe('#uriPort', function () {
      it('returns undefined', function () {
        const dockerCredentials = createCredentials();
        expect(dockerCredentials.uriPort).to.equal(uri.port);
      });
    });

    describe('#createEnvironment', function () {
      it('should return an environment with random strings', function () {
        const dockerCredentials = createCredentials();
        return Promise
          .try(() => dockerCredentials.createEnvironment())
          .then(env => {
            expect(env).to.eql(environment);
          });
      });
    });

    describe('#create', function () {
      it('should return credentials with all properties', function () {
        const dockerCredentials = createCredentials();
        const protocol = dockerCredentials.uriPrefix;
        return dockerCredentials
          .createEnvironment()
          .then(env => {
            const hostname = 'localhost';
            const port = 1234;
            const ports = {
              '1234/tcp': port
            };
            const credentials = dockerCredentials.create(env, hostname, ports);
            expect(credentials).to.eql({
              hostname: hostname,
              port: port,
              ports: ports,
              dbname: env.DBNAME,
              username: env.USERNAME,
              password: env.PASSWORD,
              uri: `${protocol}://${env.USERNAME}:${env.PASSWORD}@${hostname}:${port}/${env.DBNAME}`
            });
          });
      });

      it('should return credentials without username and dbname', function () {
        const dockerCredentials = createCredentials({
          dbname: null,
          username: null
        });
        const protocol = dockerCredentials.uriPrefix;
        const hostname = 'localhost';
        const port = 8080;
        const ports = {
          '1234/tcp': port,
          '4567/tcp': 9090
        };
        const env = _.pick(environment, 'PASSWORD');
        const credentials = dockerCredentials.create(env, hostname, ports);
        expect(credentials).to.eql({
          hostname: hostname,
          port: port,
          ports: ports,
          password: env.PASSWORD,
          uri: `${protocol}://:${env.PASSWORD}@${hostname}:${port}`
        });
      });

      it('should return credentials without password and dbname', function () {
        const dockerCredentials = createCredentials({
          dbname: null,
          password: null
        });
        const protocol = dockerCredentials.uriPrefix;
        const hostname = 'localhost';
        const port = 8080;
        const ports = {
          '1234/tcp': port
        };
        const env = _.pick(environment, 'USERNAME');
        const credentials = dockerCredentials.create(env, hostname, ports);
        expect(credentials).to.eql({
          hostname: hostname,
          port: port,
          ports: ports,
          username: env.USERNAME,
          uri: `${protocol}://${env.USERNAME}@${hostname}:${port}`
        });
      });

      it('should return credentials without uri and dbname', function () {
        const dockerCredentials = createCredentials({
          dbname: null,
          uri: null
        });
        const hostname = 'localhost';
        const port = 8080;
        const ports = {
          '5678/tcp': port
        };
        const env = _.pick(environment, 'USERNAME', 'PASSWORD');
        const credentials = dockerCredentials.create(env, hostname, ports);
        expect(credentials).to.eql({
          hostname: hostname,
          port: port,
          ports: ports,
          username: env.USERNAME,
          password: env.PASSWORD
        });
      });
    });
  });
});