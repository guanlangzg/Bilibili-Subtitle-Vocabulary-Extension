const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config.js');
const sharedSettings = require('../sharedSettings.js');

test('defaults: web page replacement should be off by default', () => {
  assert.equal(config.DEFAULT_SETTINGS.webPageEnabled, false);

  const normalized = sharedSettings.normalizeSettings({});
  assert.equal(normalized.webPageEnabled, false);

  const v3 = sharedSettings.normalizeSettingsV3({});
  assert.equal(v3.globalControls.webPageEnabled, false);
});

test('background storage: quota checks should be throttled on write path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background-storage.js'), 'utf8');
  assert.match(source, /STORAGE_CHECK_INTERVAL|lastStorageCheckAt|shouldCheckStorageUsage/);
  assert.match(source, /checkAndCleanStorageIfNeeded/);
});

test('vocabulary: learning hit persist failures should keep a retry outbox', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'vocabulary.js'), 'utf8');
  assert.match(source, /pendingLearningHits|learningHitOutbox|flushLearningHitOutbox/);
  assert.match(source, /persistLearningHit/);
});

test('manifest: web accessible resources should keep vocabulary json fetchable by content scripts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const resources = (manifest.web_accessible_resources || []).flatMap(
    (entry) => entry.resources || []
  );
  assert.ok(resources.includes('dist/overlay.js'));
  // Content scripts fetch chrome.runtime.getURL('data/...') with the page origin,
  // so MV3 rejects the request unless the resource is web-accessible.
  assert.ok(resources.includes('data/*.json'));
});

test('content teardown: should cancel debounce work and clear instance singleton', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'contentScript', 'index.js'), 'utf8');
  assert.match(
    source,
    /CONTENT_SCRIPT_INSTANCE_KEY\]\s*=\s*false|delete globalThis\[CONTENT_SCRIPT_INSTANCE_KEY\]/
  );
  const observerSource = fs.readFileSync(
    path.join(__dirname, '..', 'contentScript', 'dom-observer.js'),
    'utf8'
  );
  assert.match(observerSource, /\.cancel\(|destroyed/);
});
