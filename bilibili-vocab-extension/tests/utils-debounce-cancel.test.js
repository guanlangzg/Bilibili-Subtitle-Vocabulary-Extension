const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../utils.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('utils: debounce should expose cancel and prevent pending invocation', async () => {
  const calls = [];
  const debounced = utils.debounce((value) => {
    calls.push(value);
  }, 20);

  debounced('pending');
  assert.equal(typeof debounced.cancel, 'function');
  debounced.cancel();
  await wait(40);

  assert.deepEqual(calls, []);
});
