const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE_PATH = path.join(__dirname, '..', 'runtimeMessaging.js');

function loadRuntimeMessagingModule(options = {}) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const moduleRef = { exports: {} };
  const chrome = options.chrome;
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    console,
  };

  if (chrome) {
    sandbox.chrome = chrome;
  }

  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox, { filename: 'runtimeMessaging.js' });
  return moduleRef.exports;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

test('runtime messaging: hasRuntimeMessaging should reflect chrome runtime bridge availability', () => {
  const missing = loadRuntimeMessagingModule();
  assert.equal(missing.hasRuntimeMessaging(), false);

  const available = loadRuntimeMessagingModule({
    chrome: {
      runtime: {
        sendMessage() {},
      },
    },
  });
  assert.equal(available.hasRuntimeMessaging(), true);
});

test('runtime messaging: sendRuntimeMessage should reject when runtime bridge is unavailable', async () => {
  const runtimeMessaging = loadRuntimeMessagingModule();

  await assert.rejects(
    runtimeMessaging.sendRuntimeMessage(runtimeMessaging.MESSAGE_TYPES.SETTINGS_COMMIT, {}),
    /chrome\.runtime\.sendMessage unavailable/
  );
});

test('runtime messaging: sendRuntimeMessage should resolve payload on success', async () => {
  const runtimeMessaging = loadRuntimeMessagingModule({
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          callback({
            ok: true,
            payload: {
              echoed: message,
            },
          });
        },
      },
    },
  });

  const payload = await runtimeMessaging.sendRuntimeMessage(
    runtimeMessaging.MESSAGE_TYPES.SETTINGS_COMMIT,
    { enabled: true }
  );

  assert.deepEqual(cloneJson(payload), {
    echoed: {
      type: runtimeMessaging.MESSAGE_TYPES.SETTINGS_COMMIT,
      payload: { enabled: true },
    },
  });
});

test('runtime messaging: sendRuntimeMessage should surface chrome runtime lastError', async () => {
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        chrome.runtime.lastError = { message: 'bridge exploded' };
        callback(undefined);
        chrome.runtime.lastError = null;
      },
    },
  };
  const runtimeMessaging = loadRuntimeMessagingModule({ chrome });

  await assert.rejects(
    runtimeMessaging.sendRuntimeMessage(runtimeMessaging.MESSAGE_TYPES.SETTINGS_COMMIT, {}),
    /bridge exploded/
  );
});

test('runtime messaging: sendRuntimeMessage should use typed fallback when response is malformed', async () => {
  const runtimeMessaging = loadRuntimeMessagingModule({
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(_message, callback) {
          callback({ ok: false });
        },
      },
    },
  });

  await assert.rejects(
    runtimeMessaging.sendRuntimeMessage(runtimeMessaging.MESSAGE_TYPES.EXPERIENCE_RECORD_EVENT, {}),
    /Runtime message failed: BILI_VOCAB_EXPERIENCE_RECORD_EVENT/
  );
});

test('runtime messaging: message type literals should match the react-ui copy', () => {
  const reactSource = fs.readFileSync(
    path.join(__dirname, '..', 'react-ui', 'src', 'lib', 'runtime-messaging.ts'),
    'utf8'
  );
  const runtimeMessaging = loadRuntimeMessagingModule();

  const reactTypes = {};
  const objectMatch = reactSource.match(/export const MESSAGE_TYPES = \{([\s\S]*?)\}/);
  assert.ok(objectMatch, 'react-ui MESSAGE_TYPES block should exist');
  const pairPattern = /(\w+)\s*:\s*'([^']+)'/g;
  let match = pairPattern.exec(objectMatch[1]);
  while (match) {
    reactTypes[match[1]] = match[2];
    match = pairPattern.exec(objectMatch[1]);
  }

  assert.deepEqual(
    Object.keys(reactTypes).sort(),
    Object.keys(runtimeMessaging.MESSAGE_TYPES).sort()
  );
  Object.keys(runtimeMessaging.MESSAGE_TYPES).forEach((key) => {
    assert.equal(
      reactTypes[key],
      runtimeMessaging.MESSAGE_TYPES[key],
      `${key} should stay in sync`
    );
  });
});
