'use strict';

const uuid = require('uuid');
const crypto = require('crypto');

class SecureRandom {
  static hex(n) {
    return SecureRandom.random_bytes(n).toString('hex');
  }
  static base64(n) {
    return SecureRandom.random_bytes(n).toString('base64');
  }
  static random_bytes(n) {
    return crypto.randomBytes(n || 16);
  }
  static uuid() {
    return uuid.v4();
  }
}

class EvaluationContext {
  constructor(spec) {
    this.spec = spec;
  }

  get index() {
    return this.spec.index;
  }

  get properties() {
    return this.spec.properties;
  }

  get require() {
    return require;
  }

  get SecureRandom() {
    return SecureRandom;
  }

  p(name, defaultValue) {
    let value = this.properties;
    let keys = name.replace(/\[(\w+)\]/g, '.$1').replace(/^\./, '').split('.');
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i];
      if (key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }
    return value;
  }
}

module.exports = EvaluationContext;
