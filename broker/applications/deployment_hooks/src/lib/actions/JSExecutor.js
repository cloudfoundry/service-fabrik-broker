'use strict';

const Promise = require('bluebird');
const action = process.argv[2];
const phase = process.argv[3];
let context = process.argv[4];

// Validation of arguments
function validateArgs() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    // eslint-disable-next-line no-console
    console.error('Not enough arguments provided for script', args);
    process.exit(1);
    // Added return false for unit testing.
    return false;
  }
  return true;
}
const actionResponse = Promise.try(() => {
  if (!validateArgs()) {
    return;
  }
  const actionProcessor = require(`./js/${action}`);
  try {
    context = JSON.parse(context);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in parsing context ', context);
  }
  return Promise.try(() => actionProcessor[`execute${phase}`](context))
    // eslint-disable-next-line no-console
    .then(response => console.log(JSON.stringify(response)))
    .catch(err => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
});
module.exports = actionResponse;
