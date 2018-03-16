'use strict';

const Promise = require('bluebird');
const action = process.argv[2];
const phase = process.argv[3];
let context = process.argv[4];

const actionProcessor = require(`./js/${action}`);
try {
  context = JSON.parse(context);
} catch (err) {
  console.err('Error in parsing context ', context);
}
Promise.try(() => actionProcessor[`execute${phase}`](context))
  .then(response => console.log(JSON.stringify(response)))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });