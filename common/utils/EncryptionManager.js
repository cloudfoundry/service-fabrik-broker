'use strict';

const crypto = require('crypto');
const config = require('../config');
const CONST = require('../constants');
const RsaKeyGenerator = require('./RsaKeyGenerator');

class EncryptionManager {

  encrypt(text) {
    const cipher = crypto.createCipheriv(CONST.ENCRYPTION.AES_256_ALGORITHM, config.apiserver.encryption.key, config.apiserver.encryption.initialization_vector);
    return cipher.update(text, CONST.ENCRYPTION.INPUT_ENCODING, CONST.ENCRYPTION.OUTPUT_ENCODING);
  }

  decrypt(text) {
    var decipher = crypto.createDecipheriv(CONST.ENCRYPTION.AES_256_ALGORITHM, config.apiserver.encryption.key, config.apiserver.encryption.initialization_vector); // eslint-disable-line no-var
    return decipher.update(text, CONST.ENCRYPTION.OUTPUT_ENCODING, CONST.ENCRYPTION.INPUT_ENCODING);
  }

  async generateSshKeyPair(tempUser) { // jshint ignore: line
    const sshKeyGenerator = new RsaKeyGenerator(tempUser);
    return await sshKeyGenerator.createKeyPair(); // jshint ignore: line
  }
}

module.exports = EncryptionManager;
