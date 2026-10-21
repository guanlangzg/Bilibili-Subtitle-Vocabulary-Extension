const test = require('node:test');
const assert = require('node:assert/strict');

const sharedSettings = require('../sharedSettings.js');
const background = require('../background.js');

test('shared settings integration: background should reuse shared speed normalization', () => {
  assert.strictEqual(
    background.normalizeReviewDanmakuSpeed,
    sharedSettings.normalizeReviewDanmakuSpeed
  );
});
