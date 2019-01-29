'use strict';

const Promise = require('bluebird');
const {
  spawn
} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const uuid = require('uuid');

const fileExists = Promise.promisify(fs.access);
const unlinkFile = Promise.promisify(fs.unlink);
const readFile = Promise.promisify(fs.readFile);

class SshRsaKeyGenerator {
  constructor(user) {
    this.user = user || '';
    this.location = path.join(os.tmpdir(), `id_rsa_${uuid.v4()}`);
    this.pubFile = `${this.location}.pub`;
  }

  async fileAvailable(loc) { //jshint ignore: line
    let available = true;
    try {
      await fileExists(loc); //jshint ignore: line
    } catch (err) {
      available = false;
    }
    return available;
  }

  async forceDeleteFiles() { //jshint ignore: line
    const keyFilePresent = await this.fileAvailable(this.location); //jshint ignore: line
    const pubFilePresent = await this.fileAvailable(this.pubFile); //jshint ignore: line
    if (keyFilePresent) {
      await unlinkFile(this.location); //jshint ignore: line
    }
    if (pubFilePresent) {
      await unlinkFile(this.pubFile); //jshint ignore: line
    }
  }

  runSshKeygen() {
    return new Promise((resolve) => {
      const keygen = spawn('ssh-keygen', [
        '-t', 'rsa',
        '-b', 2048,
        '-C', this.user,
        '-f', this.location,
        '-m', 'pem',
        '-N', ''
      ]);
      keygen.on('exit', resolve);
    });
  }

  async createKeyPair() { //jshint ignore: line
    await this.forceDeleteFiles(); //jshint ignore: line
    await this.runSshKeygen(); //jshint ignore: line
    let privateKey = await readFile(this.location, 'utf8'); //jshint ignore: line
    let publicKey = await readFile(this.pubFile, 'utf8'); //jshint ignore: line
    await this.forceDeleteFiles(); //jshint ignore: line
    privateKey = privateKey.toString();
    privateKey = privateKey.substring(0, privateKey.lastIndexOf('\n')).trim();
    publicKey = publicKey.toString();
    publicKey = publicKey.substring(0, publicKey.lastIndexOf('\n')).trim();
    return {
      privateKey,
      publicKey
    };
  }
}

module.exports = SshRsaKeyGenerator;