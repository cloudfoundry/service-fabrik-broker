'use strict';

const _ = require('lodash');
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

  async fileAvailable(loc) {
    let available = true;
    try {
      await fileExists(loc)
    } catch (err) {
      available = false;
    }
    return available;
  }

  async forceDeleteFiles() {
    const keyFilePresent = await this.fileAvailable(this.location);
    const pubFilePresent = await this.fileAvailable(this.pubFile);
    if (keyFilePresent) {
      await unlinkFile(this.location);
    }
    if (pubFilePresent) {
      await unlinkFile(this.pubFile);
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

  async createKeyPair() {
    await this.forceDeleteFiles();
    await this.runSshKeygen();
    let privateKey = await readFile(this.location, 'utf8');
    let publicKey = await readFile(this.pubFile, 'utf8');
    await this.forceDeleteFiles();
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