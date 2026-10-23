const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const OVERLAY_STORAGE_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'lib',
  'overlay-storage.ts'
);
const OVERLAY_STORAGE_SOURCE_DIR = path.dirname(OVERLAY_STORAGE_SOURCE_PATH);
const SETTINGS_STORAGE_KEY_V3 = 'bili_vocab_settings_v3';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMockDate(now) {
  return class MockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }

    static parse(value) {
      return Date.parse(value);
    }

    static UTC(...args) {
      return Date.UTC(...args);
    }
  };
}

function pickPayload(state, keys) {
  if (keys == null) {
    return cloneValue(state);
  }
  return keys.reduce((accumulator, key) => {
    accumulator[key] = cloneValue(state[key]);
    return accumulator;
  }, {});
}

function createOverlayStorageModule(options = {}) {
  const source = fs.readFileSync(OVERLAY_STORAGE_SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const storageState = cloneValue(options.initialState || {});
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      if (typeof options.sendMessageImpl === 'function') {
        options.sendMessageImpl({ message, callback, state: storageState, runtime });
        return;
      }
      runtime.lastError = { message: 'sendMessage unavailable' };
      if (typeof callback === 'function') {
        callback(undefined);
      }
      runtime.lastError = null;
    },
  };
  const moduleRef = { exports: {} };
  const MockDate = createMockDate(options.now || 1700000000000);
  const changeListeners = new Set();
  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          if (typeof options.getImpl === 'function') {
            options.getImpl({ keys, callback, state: storageState, runtime });
            return;
          }
          callback(pickPayload(storageState, keys));
        },
        set(payload, callback) {
          if (typeof options.setImpl === 'function') {
            options.setImpl({ payload, callback, state: storageState, runtime });
            return;
          }
          Object.assign(storageState, cloneValue(payload));
          if (typeof callback === 'function') {
            callback();
          }
        },
      },
      onChanged: {
        addListener(listener) {
          changeListeners.add(listener);
        },
        removeListener(listener) {
          changeListeners.delete(listener);
        },
      },
    },
    runtime,
  };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require(id) {
      if (id === './chrome-storage-adapter') {
        return {
          hasChromeStorage() {
            return (
              typeof chrome !== 'undefined' &&
              Boolean(chrome.storage) &&
              Boolean(chrome.storage.local)
            );
          },
          getChromeRuntimeError(fallbackMessage) {
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) {
              return null;
            }
            return new Error(String(chrome.runtime.lastError.message || fallbackMessage));
          },
          readStorage(keys) {
            if (!chrome || !chrome.storage || !chrome.storage.local) {
              return Promise.resolve({});
            }
            return new Promise((resolve, reject) => {
              chrome.storage.local.get(keys || null, (payload) => {
                if (chrome.runtime && chrome.runtime.lastError) {
                  reject(
                    new Error(
                      String(chrome.runtime.lastError.message || 'chrome.storage.local.get failed')
                    )
                  );
                  return;
                }
                resolve(payload || {});
              });
            });
          },
          writeStorage(payload) {
            if (!chrome || !chrome.storage || !chrome.storage.local) {
              return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
              chrome.storage.local.set(payload, () => {
                if (chrome.runtime && chrome.runtime.lastError) {
                  reject(
                    new Error(
                      String(chrome.runtime.lastError.message || 'chrome.storage.local.set failed')
                    )
                  );
                  return;
                }
                resolve();
              });
            });
          },
        };
      }
      if (id === './overlay-settings') {
        return {
          SETTINGS_STORAGE_KEY_V3,
          migrateToV3(payload) {
            return payload;
          },
          normalizeSettingsV3(settings) {
            return settings;
          },
        };
      }
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
          },
          hasRuntimeMessaging() {
            return true;
          },
          sendRuntimeMessage(type, payload) {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type, payload }, (response) => {
                if (runtime.lastError) {
                  reject(new Error(runtime.lastError.message));
                  return;
                }
                if (!response || response.ok !== true) {
                  reject(new Error((response && response.error) || 'runtime bridge failed'));
                  return;
                }
                resolve(response.payload);
              });
            });
          },
        };
      }
      if (id.startsWith('.')) {
        return require(path.resolve(OVERLAY_STORAGE_SOURCE_DIR, id));
      }
      return require(id);
    },
    chrome,
    Date: MockDate,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'overlay-storage.js' });
  return {
    module: moduleRef.exports,
    storageState,
    fireOnChanged(changes, areaName = 'local') {
      changeListeners.forEach((listener) => {
        listener(changes, areaName);
      });
    },
  };
}

test('react overlay storage resilience: readStorage should reject on chrome runtime read error', async () => {
  const { module: overlayStorage } = createOverlayStorageModule({
    getImpl({ callback, runtime }) {
      runtime.lastError = { message: 'overlay storage unavailable' };
      callback(undefined);
      runtime.lastError = null;
    },
  });

  await assert.rejects(overlayStorage.readStorage(null), /overlay storage unavailable/);
});

test('react overlay storage resilience: loadOverlaySettingsV3 should not overwrite newer v3 settings discovered after migration read', async () => {
  let getCalls = 0;
  let setCalls = 0;
  const newerSettings = {
    schemaVersion: 3,
    activeProfileId: 'intensive',
  };
  const { module: overlayStorage } = createOverlayStorageModule({
    getImpl({ keys, callback }) {
      getCalls += 1;
      if (getCalls === 1) {
        callback({
          enabled: true,
          replaceRatio: 0.2,
        });
        return;
      }

      assert.equal(Array.isArray(keys), true);
      assert.equal(keys.length, 1);
      assert.equal(keys[0], SETTINGS_STORAGE_KEY_V3);
      callback({
        [SETTINGS_STORAGE_KEY_V3]: newerSettings,
      });
    },
    setImpl({ callback }) {
      setCalls += 1;
      if (typeof callback === 'function') {
        callback();
      }
    },
  });

  const loaded = await overlayStorage.loadOverlaySettingsV3();
  assert.equal(getCalls, 2);
  assert.equal(setCalls, 0);
  assert.deepEqual(loaded, newerSettings);
});

test('react overlay storage resilience: saveOverlaySettingsV3 should reject on chrome runtime write error', async () => {
  const { module: overlayStorage } = createOverlayStorageModule({
    sendMessageImpl({ callback, runtime }) {
      runtime.lastError = { message: 'overlay write failed' };
      callback(undefined);
      runtime.lastError = null;
    },
  });

  await assert.rejects(
    overlayStorage.saveOverlaySettingsV3({ schemaVersion: 3, activeProfileId: 'balanced' }),
    /overlay write failed/
  );
});

test('react overlay storage resilience: saveOverlaySettingsV3 should delegate without rewriting metrics payload', async () => {
  const { module: overlayStorage, storageState } = createOverlayStorageModule({
    initialState: {
      [EXPERIENCE_METRICS_STORAGE_KEY]: {
        schemaVersion: 1,
        updatedAt: 1700000000000,
        counters: {
          adaptiveManualOverride: 2,
        },
        daily: {
          '2023-11-14': {
            adaptiveManualOverride: 2,
          },
        },
        events: [{ type: 'adaptive-toggle', at: 1700000000000, enabled: true }],
      },
    },
    sendMessageImpl({ message, callback, state, runtime }) {
      setTimeout(() => {
        runtime.lastError = null;
        if (message.type !== 'BILI_VOCAB_SETTINGS_COMMIT') {
          callback({ ok: false, error: 'unexpected message' });
          return;
        }
        state[SETTINGS_STORAGE_KEY_V3] = cloneValue(message.payload.settings);
        callback({
          ok: true,
          payload: cloneValue(message.payload.settings),
        });
      }, 5);
    },
  });

  await Promise.all([
    overlayStorage.saveOverlaySettingsV3({ schemaVersion: 3, activeProfileId: 'gentle' }),
    overlayStorage.saveOverlaySettingsV3({ schemaVersion: 3, activeProfileId: 'balanced' }),
  ]);

  assert.equal(storageState[SETTINGS_STORAGE_KEY_V3].activeProfileId, 'balanced');
  assert.equal(storageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride, 2);
  assert.deepEqual(storageState[EXPERIENCE_METRICS_STORAGE_KEY].events, [
    { type: 'adaptive-toggle', at: 1700000000000, enabled: true },
  ]);
});

test('react overlay storage resilience: subscribeLearningSummary should normalize changed summary payload', () => {
  const updates = [];
  const { module: overlayStorage, fireOnChanged } = createOverlayStorageModule();

  const unsubscribe = overlayStorage.subscribeLearningSummary((summary) => {
    updates.push(cloneValue(summary));
  });

  fireOnChanged({
    bili_vocab_learning_summary_v1: {
      newValue: {
        todayCount: '3',
        newCount: -1,
        masteredCount: 2.8,
        recentWords: [
          {
            word: ' lexicon ',
            translation: ' 词汇 ',
            status: ' saved ',
          },
          {
            word: '',
            translation: 'ignored',
          },
        ],
      },
    },
  });
  unsubscribe();
  fireOnChanged({
    bili_vocab_learning_summary_v1: {
      newValue: {
        todayCount: 99,
      },
    },
  });

  assert.deepEqual(updates, [
    {
      todayCount: 3,
      newCount: 0,
      masteredCount: 2,
      recentWords: [
        {
          word: 'lexicon',
          status: 'saved',
        },
      ],
    },
  ]);
});
