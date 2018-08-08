'use strict';

const EncryptionManager = require('../../common/utils/EncryptionManager');

describe('utils', () => {
  describe('EncryptionManager', () => {
    /* jshint expr:true */
    describe('encrypt-decrypt-simple', () => {
      it('returns the same string after decryption', () => {
        const manager = new EncryptionManager();
        const testText = 'Hello World';
        const encryptedText = manager.encrypt(testText);
        const decryptedText = manager.decrypt(encryptedText);
        expect(decryptedText).to.equal(testText);
      });
    });
    describe('encrypt-decrypt-complex', () => {
      it('returns the same string after decryption', () => {
        const manager = new EncryptionManager();
        const testObj = {
          hostname: '10.244.12.64',
          hosts: [
            '10.244.12.64'
          ],
          password: 'a6e4a09e54ead15079d01e7748376b2d',
          port: 8080,
          uri: 'http://187ff800d545ba30259ec25cb15713d4:a6e4a09e54ead15079d01e7748376b2d@10.244.12.64:8080',
          username: '187ff800d545ba30259ec25cb15713d4'
        };
        const testText = JSON.stringify(testObj);
        const encryptedText = manager.encrypt(testText);
        const decryptedText = manager.decrypt(encryptedText);
        expect(JSON.parse(decryptedText)).to.deep.equal(testObj);
      });
    });
  });
});