'use strict';

const proxyquire = require('proxyquire');
const Promise = require('bluebird');
const SshConnectionFailed = require('../../common/errors').SshConnectionFailed;
const events = require('events');

let connection = new events.EventEmitter();

function Client() {
  return connection;
}

const BoshSshClient = proxyquire('../../data-access-layer/bosh/BoshSshClient', {
  'ssh2': {
    Client: Client
  }
});
const connectOptions = {
  host: 'ip',
  privateKey: 'privkey',
  username: 'user'
};
const deploymentOptions = {
  deploymentName: 'dep',
  job: 'job'
};
const linuxcommand = 'fancy';

describe('bosh', () => {
  describe('BoshSshClient', () => {
    describe('getConnection', () => {
      it('should get SSH connection which fails on connect', () => {
        const subject = new BoshSshClient(connectOptions, deploymentOptions);
        connection.connect = function () {
          connection.emit('error', new Error('Failed to connect'));
        };
        let connect = sinon.spy(connection, 'connect');
        return subject.getConnection()
          .catch(err => {
            expect(connect.calledOnce).to.eql(true);
            expect(connect.firstCall.args[0]).to.deep.equal(connectOptions);
            expect(err instanceof SshConnectionFailed).to.eql(true);
            expect(err.message).to.equal('Failed to connect');
          });
      });
      it('should get SSH connection which fails on connect and gets closed when using disposer', () => {
        const subject = new BoshSshClient(connectOptions, deploymentOptions);
        connection.connect = function () {
          connection.emit('error', new Error('Failed to connect'));
        };
        let connect = sinon.spy(connection, 'connect');
        connection.end = sinon.stub();
        return Promise.using(subject.getConnection(), conn => {
            expect(connect.calledOnce).to.eql(true);
            expect(connect.firstCall.args[0]).to.deep.equal(connectOptions);
            expect(conn).to.eql(connection);
            expect(connection.end.notCalled).to.eql(true);
          })
          .catch(err => {
            expect(connect.calledOnce).to.eql(true);
            expect(err instanceof SshConnectionFailed).to.eql(true);
            expect(err.message).to.equal('Failed to connect');
          });
      });
      it('should get SSH connection which is closed and disposed of when used with Promise.using', () => {
        const subject = new BoshSshClient(connectOptions, deploymentOptions);
        connection.connect = function () {
          connection.emit('ready');
        };
        let connect = sinon.spy(connection, 'connect');
        connection.end = sinon.stub();
        return Promise.using(subject.getConnection(), conn => {
            expect(connect.calledOnce).to.eql(true);
            expect(connect.firstCall.args[0]).to.deep.equal(connectOptions);
            expect(conn).to.eql(connection);
            expect(connection.end.notCalled).to.eql(true);
          })
          .then(() => {
            expect(connection.end.calledOnce).to.eql(true);
          });
      });
    });

    describe('executeCommand', () => {
      it('should fail on error', () => {
        const subject = new BoshSshClient(connectOptions, deploymentOptions);
        connection.exec = sinon.stub();
        connection.exec.callsArgWith(1, new Error('Failed to exec'));
        return subject.executeCommand(connection, linuxcommand)
          .catch(err => {
            expect(connection.exec.calledOnce).to.eql(true);
            expect(connection.exec.firstCall.args[0]).to.eql(linuxcommand);
            expect(err.message).to.eql('Failed to exec');
          });
      });
      it('should execute command and return code, stdout and stderr', () => {
        const subject = new BoshSshClient(connectOptions, deploymentOptions);
        let stream = new events.EventEmitter();
        stream.stderr = new events.EventEmitter();
        connection.exec = sinon.stub();
        connection.exec.callsArgWith(1, undefined, stream);
        let execPromise = subject.executeCommand(connection, linuxcommand);
        stream.emit('data', 'out 1 ');
        stream.stderr.emit('data', 'err 1 ');
        stream.stderr.emit('data', 'err 2 ');
        stream.emit('data', 'out 2 ');
        stream.emit('close', 0);
        return execPromise
          .then((result) => {
            expect(connection.exec.calledOnce).to.eql(true);
            expect(connection.exec.calledWith(linuxcommand)).to.eql(true);
            expect(result.code).to.equal(0);
            expect(result.stdout).to.equal('out 1 out 2');
            expect(result.stderr).to.equal('err 1 err 2');
          });
      });
    });

    describe('run', () => {
      it('should run command and close connection', () => {
        const subject = new BoshSshClient(connectOptions, deploymentOptions);
        connection.connect = function () {
          connection.emit('ready');
        };
        let connect = sinon.spy(connection, 'connect');
        connection.end = sinon.stub();
        let stream = new events.EventEmitter();
        stream.stderr = new events.EventEmitter();
        connection.exec = sinon.stub();
        connection.exec.callsArgWith(1, undefined, stream);

        setTimeout(() => {
          stream.emit('data', 'out 1 ');
          stream.stderr.emit('data', 'err 1 ');
          stream.stderr.emit('data', 'err 2 ');
          stream.emit('data', 'out 2 ');
          stream.emit('close', 0);
        }, 500);

        const runPromise = subject.run(linuxcommand);
        return runPromise
          .then((result) => {
            expect(connect.calledOnce).to.eql(true);
            expect(connect.firstCall.args[0]).to.deep.equal(connectOptions);
            expect(connection.exec.calledOnce).to.eql(true);
            expect(connection.exec.calledWith(linuxcommand)).to.eql(true);
            expect(result.code).to.equal(0);
            expect(result.stdout).to.equal('out 1 out 2');
            expect(result.stderr).to.equal('err 1 err 2');
            expect(connection.end.calledOnce).to.eql(true);
          });
      });
    });
  });
});