'use strict';

const crypto = require('crypto');
const config = require('../config');
const CONST = require('../constants');

class EncryptionManager {

  /**
   * @param text test to be encrypted
   */
  encrypt(text) {
    const cipher = crypto.createCipher(CONST.APISERVER.ENCRYPTION.AES_256_ALGORITHM, config.apiserver.encryption.password);
    let crypted = cipher.update(text, CONST.APISERVER.ENCRYPTION.INPUT_ENCODING, CONST.APISERVER.ENCRYPTION.OUTPUT_ENCODING);
    crypted += cipher.final(CONST.APISERVER.ENCRYPTION.OUTPUT_ENCODING);
    return crypted;
  }

  /**
   * @param text test to be decrypted
   */
  decrypt(text) {
    var decipher = crypto.createDecipher(CONST.APISERVER.ENCRYPTION.AES_256_ALGORITHM, config.apiserver.encryption.password);
    let dec = decipher.update(text, CONST.APISERVER.ENCRYPTION.OUTPUT_ENCODING, CONST.APISERVER.ENCRYPTION.INPUT_ENCODING);
    dec += decipher.final(CONST.APISERVER.ENCRYPTION.INPUT_ENCODING);
    return dec;
  }

}

module.exports = EncryptionManager;