'use strict';

const crypto = require('crypto');
const config = require('../config');
const CONST = require('../constants');

class EncryptionManager {

  /**
   * @param text test to be encrypted
   */
  encrypt(text) {
    const cipher = crypto.createCipheriv(CONST.ENCRYPTION.AES_256_ALGORITHM, config.apiserver.encryption.password, config.apiserver.encryption.initialization_vector);
    let crypted = cipher.update(text, CONST.ENCRYPTION.INPUT_ENCODING, CONST.ENCRYPTION.OUTPUT_ENCODING);
    crypted += cipher.final(CONST.ENCRYPTION.OUTPUT_ENCODING);
    return crypted;
  }

  /**
   * @param text test to be decrypted
   */
  decrypt(text) {
    var decipher = crypto.createDecipheriv(CONST.ENCRYPTION.AES_256_ALGORITHM, config.apiserver.encryption.password, config.apiserver.encryption.initialization_vector);
    let dec = decipher.update(text, CONST.ENCRYPTION.OUTPUT_ENCODING, CONST.ENCRYPTION.INPUT_ENCODING);
    dec += decipher.final(CONST.ENCRYPTION.INPUT_ENCODING);
    return dec;
  }

}

module.exports = EncryptionManager;