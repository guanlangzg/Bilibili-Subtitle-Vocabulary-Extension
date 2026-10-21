const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config.js');

test('config: should expose shipped setting vocabularies', () => {
  assert.deepEqual(config.LEVELS, ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL']);
  assert.deepEqual(config.CEFR_LEVELS, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  assert.deepEqual(config.REVIEW_SPEEDS, ['slow', 'normal', 'fast']);
  assert.deepEqual(config.REVIEW_DENSITIES, ['sparse', 'normal', 'dense']);
  assert.deepEqual(config.VOCABULARY_MODES, ['core', 'full']);
  assert.deepEqual(config.EXAM_PREFERENCES, ['balanced', 'exam-first']);
});

test('config: default settings should stay aligned with shipped defaults without aliasing level array', () => {
  assert.equal(config.DEFAULT_SETTINGS.enabled, true);
  assert.equal(config.DEFAULT_SETTINGS.schemaVersion, 2);
  assert.equal(config.DEFAULT_SETTINGS.reviewDanmakuEnabled, false);
  assert.equal(config.DEFAULT_SETTINGS.reviewDanmakuSpeed, 'normal');
  assert.equal(config.DEFAULT_SETTINGS.reviewDanmakuDensity, 'normal');
  assert.equal(config.DEFAULT_SETTINGS.vocabularyMode, 'core');
  assert.equal(config.DEFAULT_SETTINGS.examPreference, 'balanced');
  assert.equal(config.DEFAULT_SETTINGS.webPageEnabled, false);
  assert.equal(config.DEFAULT_SETTINGS.replaceRatio, 0.2);
  assert.equal(config.DEFAULT_SETTINGS.maxReplaceCount, 2);
  assert.equal(config.DEFAULT_SETTINGS.targetCefr, 'B2');
  assert.equal(config.DEFAULT_SETTINGS.bilingualMode, 'default');
  assert.equal(config.DEFAULT_SETTINGS.themeMode, 'auto');
  assert.deepEqual(config.DEFAULT_SETTINGS.activeLevels, config.LEVELS);
  assert.notEqual(config.DEFAULT_SETTINGS.activeLevels, config.LEVELS);
});
