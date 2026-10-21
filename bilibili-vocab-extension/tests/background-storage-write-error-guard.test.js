const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sharedSettings = require('../sharedSettings.js');

const backgroundPath = path.join(__dirname, '..', 'background.js');
const WORD_STATS_V2_KEY = 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_SUMMARY_KEY = 'bili_vocab_learning_summary_v1';

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createChromeStub({ storageState, shouldFailSet, getBytesInUse, sendMessageImpl }) {
  const listeners = {
    installed: null,
    startup: null,
    command: null,
  };
  const removedKeys = [];
  const sentMessages = [];
  const runtime = {
    id: 'bili-vocab-extension-id',
    lastError: null,
    onInstalled: {
      addListener(listener) {
        listeners.installed = listener;
      },
    },
    onStartup: {
      addListener(listener) {
        listeners.startup = listener;
      },
    },
  };

  return {
    chrome: {
      runtime,
      commands: {
        onCommand: {
          addListener(listener) {
            listeners.command = listener;
          },
        },
      },
      tabs: {
        query(_query, callback) {
          callback([{ id: 7, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }]);
        },
        sendMessage(tabId, message, callback) {
          sentMessages.push({ tabId, message });
          if (typeof sendMessageImpl === 'function') {
            return sendMessageImpl(tabId, message, callback, runtime);
          }
          return undefined;
        },
      },
      storage: {
        local: {
          get(keys, callback) {
            if (Array.isArray(keys)) {
              callback(
                keys.reduce((payload, key) => {
                  payload[key] = storageState[key];
                  return payload;
                }, {})
              );
              return;
            }
            callback({ ...storageState });
          },
          getBytesInUse(keys, callback) {
            const bytes =
              typeof getBytesInUse === 'function'
                ? getBytesInUse(keys, storageState)
                : JSON.stringify(storageState).length;
            callback(bytes);
          },
          set(payload, callback) {
            const failure = typeof shouldFailSet === 'function' ? shouldFailSet(payload) : false;
            const failed = Boolean(failure);
            if (!failed) {
              Object.assign(storageState, payload);
            }
            runtime.lastError = failed
              ? { message: typeof failure === 'string' ? failure : 'mock set failure' }
              : null;
            if (typeof callback === 'function') {
              callback();
            }
            runtime.lastError = null;
          },
          remove(keys) {
            removedKeys.push(Array.isArray(keys) ? keys.slice() : [keys]);
          },
        },
      },
    },
    listeners,
    removedKeys,
    sentMessages,
    storageState,
  };
}

async function withBackgroundRuntime(options, run) {
  const previousChrome = global.chrome;
  const previousConsoleError = console.error;
  const stub = createChromeStub(options);
  const loggedErrors = [];
  const modulePaths = [
    backgroundPath,
    path.join(__dirname, '..', 'background-storage.js'),
    path.join(__dirname, '..', 'background-settings.js'),
    path.join(__dirname, '..', 'background-message-handler.js'),
    path.join(__dirname, '..', 'background-commands.js'),
    path.join(__dirname, '..', 'background-learning-state.js'),
    path.join(__dirname, '..', 'runtimeMessaging.js'),
  ];

  try {
    global.chrome = stub.chrome;
    console.error = (...args) => {
      loggedErrors.push(args);
    };

    for (const modulePath of modulePaths) {
      try {
        delete require.cache[require.resolve(modulePath)];
      } catch (_error) {
        // Module may not be loaded yet.
      }
    }
    delete require.cache[require.resolve(backgroundPath)];
    const background = require(backgroundPath);
    await run({
      background,
      listeners: stub.listeners,
      removedKeys: stub.removedKeys,
      sentMessages: stub.sentMessages,
      storageState: stub.storageState,
      loggedErrors,
    });
  } finally {
    delete require.cache[require.resolve(backgroundPath)];
    global.chrome = previousChrome;
    console.error = previousConsoleError;
  }
}

test('ensureDefaultSettings: should keep legacy keys when storage write fails', async () => {
  const storageState = {
    level: 'cet6',
    testDanmakuMode: true,
  };

  await withBackgroundRuntime(
    {
      storageState,
      shouldFailSet(payload) {
        return Object.prototype.hasOwnProperty.call(
          payload,
          sharedSettings.SETTINGS_STORAGE_KEY_V3
        );
      },
    },
    async ({ background, removedKeys, storageState: nextStorageState, loggedErrors }) => {
      background.ensureDefaultSettings();
      await flushAsync();

      assert.equal(removedKeys.length, 0);
      assert.equal(nextStorageState.level, 'cet6');
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          nextStorageState,
          sharedSettings.SETTINGS_STORAGE_KEY_V3
        ),
        false
      );
      assert.equal(loggedErrors.length, 1);
    }
  );
});

test('background command: should skip broadcast when storage write fails', async () => {
  const storageState = {
    [sharedSettings.SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
  };

  await withBackgroundRuntime(
    {
      storageState,
      shouldFailSet(payload) {
        return Object.prototype.hasOwnProperty.call(
          payload,
          sharedSettings.SETTINGS_STORAGE_KEY_V3
        );
      },
    },
    async ({ listeners, sentMessages, storageState: nextStorageState, loggedErrors }) => {
      await listeners.command('toggle-overlay');
      await flushAsync();

      assert.equal(sentMessages.length, 0);
      assert.equal(
        nextStorageState[sharedSettings.SETTINGS_STORAGE_KEY_V3].globalControls.overlayState.hidden,
        false
      );
      assert.equal(loggedErrors.length, 1);
    }
  );
});

test('background command: should consume tabs.sendMessage lastError when receiver is missing', async () => {
  const storageState = {
    [sharedSettings.SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
  };
  let runtimeError = null;
  let runtimeErrorReads = 0;

  await withBackgroundRuntime(
    {
      storageState,
      sendMessageImpl(_tabId, _message, callback, runtime) {
        Object.defineProperty(runtime, 'lastError', {
          configurable: true,
          enumerable: true,
          get() {
            runtimeErrorReads += 1;
            return runtimeError;
          },
          set(value) {
            runtimeError = value;
          },
        });
        runtime.lastError = {
          message: 'Could not establish connection. Receiving end does not exist.',
        };
        callback();
        runtime.lastError = null;
        return undefined;
      },
    },
    async ({ listeners, sentMessages, loggedErrors }) => {
      await listeners.command('toggle-overlay');
      await flushAsync();

      assert.equal(sentMessages.length, 1);
      assert.equal(runtimeErrorReads, 1);
      assert.equal(loggedErrors.length, 0);
    }
  );
});

test('background command: should tolerate callback-style tabs.sendMessage on success', async () => {
  const storageState = {
    [sharedSettings.SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
  };

  await withBackgroundRuntime(
    {
      storageState,
      sendMessageImpl() {
        return undefined;
      },
    },
    async ({ listeners, sentMessages, storageState: nextStorageState, loggedErrors }) => {
      await listeners.command('toggle-overlay');
      await flushAsync();

      assert.equal(
        nextStorageState[sharedSettings.SETTINGS_STORAGE_KEY_V3].globalControls.overlayState.hidden,
        true
      );
      assert.deepEqual(sentMessages, [
        {
          tabId: 7,
          message: {
            type: 'SETTINGS_UPDATED',
            payload: nextStorageState[sharedSettings.SETTINGS_STORAGE_KEY_V3],
          },
        },
      ]);
      assert.equal(loggedErrors.length, 0);
    }
  );
});

test('storage cleanup: should preserve saved and reviewed words while pruning stale low-value words', async () => {
  const now = Date.now();
  const staleAt = now - 120 * 24 * 60 * 60 * 1000;
  const recentAt = now - 2 * 24 * 60 * 60 * 1000;
  const storageState = {
    level: 'cet4',
    [WORD_STATS_V2_KEY]: {
      stale: {
        word: 'stale',
        status: 'seen',
        hitCount: 1,
        lastSeenAt: staleAt,
      },
      saved: {
        word: 'saved',
        status: 'saved',
        hitCount: 1,
        lastSeenAt: staleAt,
        savedAt: staleAt,
      },
      reviewed: {
        word: 'reviewed',
        status: 'seen',
        hitCount: 1,
        lastSeenAt: staleAt,
        reviewCount: 1,
      },
      repeated: {
        word: 'repeated',
        status: 'seen',
        hitCount: 2,
        lastSeenAt: staleAt,
      },
      recent: {
        word: 'recent',
        status: 'seen',
        hitCount: 1,
        lastSeenAt: recentAt,
      },
    },
    [REVIEW_QUEUE_KEY]: {
      stale: { word: 'stale', dueBucket: 'today' },
      saved: { word: 'saved', dueBucket: 'soon' },
      reviewed: { word: 'reviewed', dueBucket: 'later' },
    },
  };

  await withBackgroundRuntime(
    {
      storageState,
      getBytesInUse() {
        return 9 * 1024 * 1024;
      },
    },
    async ({ background, storageState: nextStorageState }) => {
      background.ensureDefaultSettings();
      await flushAsync();
      await flushAsync();

      assert.equal(nextStorageState[WORD_STATS_V2_KEY].stale, undefined);
      assert.equal(nextStorageState[REVIEW_QUEUE_KEY].stale, undefined);
      assert.equal(nextStorageState[WORD_STATS_V2_KEY].saved.status, 'saved');
      assert.equal(nextStorageState[WORD_STATS_V2_KEY].reviewed.reviewCount, 1);
      assert.equal(nextStorageState[WORD_STATS_V2_KEY].repeated.hitCount, 2);
      assert.equal(nextStorageState[WORD_STATS_V2_KEY].recent.hitCount, 1);
      assert.equal(nextStorageState[LEARNING_SUMMARY_KEY].queueCount, 2);
      assert.equal(nextStorageState[LEARNING_SUMMARY_KEY].savedCount, 1);
      assert.equal(nextStorageState[LEARNING_SUMMARY_KEY].seenCount, 3);
    }
  );
});

test('storage cleanup: should clean stale words and retry once after quota write failure', async () => {
  const staleAt = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const storageState = {
    level: 'cet6',
    [WORD_STATS_V2_KEY]: {
      stale: {
        word: 'stale',
        status: 'seen',
        hitCount: 1,
        lastSeenAt: staleAt,
      },
      saved: {
        word: 'saved',
        status: 'saved',
        hitCount: 1,
        lastSeenAt: staleAt,
        savedAt: staleAt,
      },
    },
    [REVIEW_QUEUE_KEY]: {
      stale: { word: 'stale', dueBucket: 'today' },
      saved: { word: 'saved', dueBucket: 'soon' },
    },
  };
  let settingsWriteAttempts = 0;

  await withBackgroundRuntime(
    {
      storageState,
      getBytesInUse() {
        return 4 * 1024 * 1024;
      },
      shouldFailSet(payload) {
        if (
          !Object.prototype.hasOwnProperty.call(payload, sharedSettings.SETTINGS_STORAGE_KEY_V3)
        ) {
          return false;
        }
        settingsWriteAttempts += 1;
        return settingsWriteAttempts === 1 ? 'QUOTA_BYTES quota exceeded' : false;
      },
    },
    async ({ background, storageState: nextStorageState, removedKeys }) => {
      background.ensureDefaultSettings();
      await flushAsync();
      await flushAsync();

      assert.equal(settingsWriteAttempts, 2);
      assert.equal(nextStorageState[WORD_STATS_V2_KEY].stale, undefined);
      assert.equal(nextStorageState[WORD_STATS_V2_KEY].saved.status, 'saved');
      assert.equal(nextStorageState[REVIEW_QUEUE_KEY].stale, undefined);
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          nextStorageState,
          sharedSettings.SETTINGS_STORAGE_KEY_V3
        ),
        true
      );
      assert.equal(removedKeys.length, 1);
    }
  );
});
