const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXTENSION_ID = 'bili-vocab-extension-id';
const ROOT = path.join(__dirname, '..');

function loadScript(relativePath, sandbox) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const moduleRef = { exports: {} };
  sandbox.module = moduleRef;
  sandbox.exports = moduleRef.exports;
  sandbox.__filename = filename;
  sandbox.__dirname = path.dirname(filename);
  sandbox.require = function localRequire(request) {
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolved = path.resolve(sandbox.__dirname, request);
      const cached = require.cache[resolved] || require.cache[resolved + '.js'];
      if (cached) {
        return cached.exports;
      }
      // Load dependency into the same sandbox graph via Node require from absolute path.
      return require(resolved);
    }
    return require(request);
  };
  vm.runInNewContext(source, sandbox, { filename: relativePath });
  return moduleRef.exports;
}

function loadBackgroundMessageHandler(chromeStub) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Date,
    JSON,
    Math,
    Error,
    chrome: chromeStub,
  };
  sandbox.globalThis = sandbox;

  const moduleOrder = [
    'config.js',
    'sharedSettings.js',
    'runtimeMessaging.js',
    'adaptiveTuning.js',
    'experienceMetrics.js',
    'learningState.js',
    'background-settings.js',
    'background-storage.js',
    'background-learning-state.js',
    'background-message-handler.js',
  ];

  let lastExports = null;
  for (const relativePath of moduleOrder) {
    lastExports = loadScript(relativePath, sandbox);
  }

  return sandbox.BackgroundMessageHandler || lastExports;
}

function createStorageChrome() {
  const state = {};
  return {
    runtime: {
      id: EXTENSION_ID,
      lastError: null,
    },
    storage: {
      local: {
        get(keys, callback) {
          if (keys == null) {
            callback({ ...state });
            return;
          }
          const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
          if (!Array.isArray(keys) && keys && typeof keys === 'object' && !Array.isArray(keys)) {
            // chrome.storage get with object defaults
            const payload = {};
            for (const key of Object.keys(keys)) {
              payload[key] = state[key] !== undefined ? state[key] : keys[key];
            }
            callback(payload);
            return;
          }
          const payload = {};
          for (const key of keyList) {
            payload[key] = state[key];
          }
          callback(payload);
        },
        set(payload, callback) {
          Object.assign(state, payload);
          if (typeof callback === 'function') {
            callback();
          }
        },
        getBytesInUse(_keys, callback) {
          callback(0);
        },
      },
    },
  };
}

test('background message trust: should reject SETTINGS_COMMIT from foreign extension id', async () => {
  const chromeStub = createStorageChrome();
  const handler = loadBackgroundMessageHandler(chromeStub);

  let response = null;
  const keptChannel = handler.handleBackgroundMessage(
    {
      type: 'BILI_VOCAB_SETTINGS_COMMIT',
      payload: {
        settings: require('../sharedSettings.js').getDefaultSettingsV3(),
        markManualOverride: false,
      },
    },
    { id: 'evil-extension' },
    (value) => {
      response = value;
    }
  );

  assert.equal(keptChannel, false);
  assert.equal(response && response.ok, false);
  assert.match(String((response && response.error) || ''), /untrusted|sender/i);
});

test('background message trust: should accept SETTINGS_COMMIT from same extension id', async () => {
  const chromeStub = createStorageChrome();
  const handler = loadBackgroundMessageHandler(chromeStub);
  const settings = require('../sharedSettings.js').getDefaultSettingsV3();

  const response = await new Promise((resolve) => {
    const keptChannel = handler.handleBackgroundMessage(
      {
        type: 'BILI_VOCAB_SETTINGS_COMMIT',
        payload: {
          settings,
          markManualOverride: false,
        },
      },
      { id: EXTENSION_ID },
      resolve
    );
    assert.equal(keptChannel, true);
  });

  assert.equal(response.ok, true);
  assert.ok(response.payload);
});

test('content lifecycle trust: teardown listener should ignore foreign extension senders', () => {
  const source = fs.readFileSync(path.join(ROOT, 'contentScript', 'index.js'), 'utf8');
  assert.match(
    source,
    /isTrustedExtensionSender|sender\.id\s*===\s*chrome\.runtime\.id|sender\.id\s*!==\s*chrome\.runtime\.id/
  );
  assert.match(source, /BILI_VOCAB_CONTENT_TEARDOWN/);
  assert.doesNotMatch(
    source,
    /runtime\.onMessage\.addListener\(\(message, _sender, sendResponse\) => \{\s*if \(!message \|\| message\.type !== 'BILI_VOCAB_CONTENT_TEARDOWN'\)/
  );
});

test('subtitle navigation trust: runtime message handler should validate sender id', () => {
  const source = fs.readFileSync(path.join(ROOT, 'subtitleNavigationController.js'), 'utf8');
  assert.match(source, /isTrustedExtensionSender|sender\.id/);
  assert.doesNotMatch(source, /addListener\(\(message, _sender, sendResponse\)/);
});
