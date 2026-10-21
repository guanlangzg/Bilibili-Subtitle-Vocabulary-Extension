const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharedSettings = require('../sharedSettings.js');

const backgroundPath = path.join(__dirname, '..', 'background.js');
const experienceMetricsPath = path.join(__dirname, '..', 'experienceMetrics.js');
const storageSourcePath = path.join(__dirname, '..', 'react-ui', 'src', 'lib', 'storage.ts');
const learningDashboardSourcePath = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'lib',
  'learning-dashboard.ts'
);
const storageSourceDir = path.dirname(storageSourcePath);
const SETTINGS_STORAGE_KEY_V3 = 'bili_vocab_settings_v3';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
const WORD_STATS_V2_KEY = 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_SUMMARY_KEY = 'bili_vocab_learning_summary_v1';

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function createChromeStub(storageState) {
  const listeners = {
    installed: null,
    startup: null,
    command: null,
    message: null,
  };
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
    onMessage: {
      addListener(listener) {
        listeners.message = listener;
      },
    },
    openOptionsPage() {
      return Promise.resolve();
    },
    sendMessage(message, callback) {
      if (typeof listeners.message !== 'function') {
        runtime.lastError = { message: 'no background listener' };
        if (typeof callback === 'function') {
          callback(undefined);
        }
        runtime.lastError = null;
        return;
      }

      try {
        listeners.message(message, { id: 'bili-vocab-extension-id' }, (response) => {
          if (typeof callback === 'function') {
            callback(response);
          }
        });
      } catch (error) {
        runtime.lastError = { message: String(error && error.message ? error.message : error) };
        if (typeof callback === 'function') {
          callback(undefined);
        }
        runtime.lastError = null;
      }
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
          callback([]);
        },
        sendMessage() {
          return undefined;
        },
      },
      storage: {
        local: {
          get(keys, callback) {
            callback(pickPayload(storageState, keys));
          },
          set(payload, callback) {
            Object.assign(storageState, cloneValue(payload));
            if (typeof callback === 'function') {
              callback();
            }
          },
          remove() {},
        },
      },
    },
    listeners,
  };
}

function loadLearningDashboardModule() {
  const source = fs.readFileSync(learningDashboardSourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require,
    Date,
    console,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'learning-dashboard.js' });
  return moduleRef.exports;
}

function loadStorageModule(chrome) {
  const source = fs.readFileSync(storageSourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require(id) {
      if (id === './settings-bridge') {
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
      if (id === './learning-dashboard') {
        return loadLearningDashboardModule();
      }
      if (id === './chrome-storage-adapter') {
        return {
          readStorage(keys) {
            return new Promise((resolve, reject) => {
              chrome.storage.local.get(keys == null ? null : keys, (payload) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve(payload || {});
              });
            });
          },
          writeStorage(payload) {
            return new Promise((resolve, reject) => {
              chrome.storage.local.set(payload, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve();
              });
            });
          },
        };
      }
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
            ADAPTIVE_PERSIST_FEEDBACK: 'BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK',
            ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
          },
          sendRuntimeMessage(type, payload) {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type, payload }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
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
        return require(path.resolve(storageSourceDir, id));
      }
      return require(id);
    },
    chrome,
    Date,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'storage.js' });
  return moduleRef.exports;
}

function sendRuntimeMessage(chrome, type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.ok !== true) {
        reject(new Error((response && response.error) || 'runtime bridge failed'));
        return;
      }
      resolve(response.payload);
    });
  });
}

async function withBackground(storageState, run) {
  const previousChrome = global.chrome;
  const stub = createChromeStub(storageState);

  delete require.cache[require.resolve(backgroundPath)];
  delete require.cache[require.resolve(experienceMetricsPath)];

  try {
    global.chrome = stub.chrome;
    require(backgroundPath);
    const storageModule = loadStorageModule(stub.chrome);
    const experienceMetrics = require(experienceMetricsPath);
    await run({
      chrome: stub.chrome,
      storageModule,
      experienceMetrics,
      storageState,
      listeners: stub.listeners,
    });
  } finally {
    delete require.cache[require.resolve(backgroundPath)];
    delete require.cache[require.resolve(experienceMetricsPath)];
    global.chrome = previousChrome;
  }
}

test('background shared state mutation: react save should preserve existing metrics events', async () => {
  const storageState = {
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: 1700000000000,
      counters: {
        adaptiveManualOverride: 0,
      },
      daily: {},
      events: [{ type: 'context-misreplace', at: 1700000000000, severity: 'high' }],
    },
  };

  await withBackground(storageState, async ({ storageModule, storageState: nextStorageState }) => {
    await storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: 'balanced' });

    assert.equal(nextStorageState[SETTINGS_STORAGE_KEY_V3].activeProfileId, 'balanced');
    assert.equal(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
      1
    );
    assert.deepEqual(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.map((item) => item.type),
      ['context-misreplace', 'adaptive-manual-override']
    );
  });
});

test('background shared state mutation: react save and runtime metrics should not lose each other', async () => {
  const storageState = {
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: null,
      counters: {},
      daily: {},
      events: [],
    },
  };

  await withBackground(
    storageState,
    async ({ storageModule, experienceMetrics, storageState: nextStorageState }) => {
      await Promise.all([
        storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: 'intensive' }),
        experienceMetrics.recordEvent('context-misreplace', {
          severity: 'high',
          now: 1700000005000,
        }),
      ]);

      assert.equal(nextStorageState[SETTINGS_STORAGE_KEY_V3].activeProfileId, 'intensive');
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceReported,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceHigh,
        1
      );
      assert.deepEqual(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.map((item) => item.type).sort(),
        ['adaptive-manual-override', 'context-misreplace']
      );
    }
  );
});

test('background shared state mutation: keyboard command should serialize with metrics and mark manual override', async () => {
  const storageState = {
    [SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: null,
      counters: {},
      daily: {},
      events: [],
    },
  };

  await withBackground(
    storageState,
    async ({ listeners, experienceMetrics, storageState: nextStorageState }) => {
      const baselineRatio =
        nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio;

      await Promise.all([
        listeners.command('increase-ratio'),
        experienceMetrics.recordEvent('context-misreplace', {
          severity: 'high',
          now: 1700000005000,
        }),
      ]);

      assert.equal(
        nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio,
        baselineRatio + 0.05
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceReported,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceHigh,
        1
      );
      assert.deepEqual(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.map((item) => item.type).sort(),
        ['adaptive-manual-override', 'context-misreplace']
      );
    }
  );
});

test('background shared state mutation: concurrent keyboard commands should build on latest settings', async () => {
  const storageState = {
    [SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: null,
      counters: {},
      daily: {},
      events: [],
    },
  };

  await withBackground(storageState, async ({ listeners, storageState: nextStorageState }) => {
    const baselineRatio =
      nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio;

    await Promise.all([listeners.command('increase-ratio'), listeners.command('increase-ratio')]);

    assert.equal(
      nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio,
      Number((baselineRatio + 0.1).toFixed(2))
    );
    assert.equal(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
      2
    );
    assert.equal(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.filter(
        (item) => item.type === 'adaptive-manual-override'
      ).length,
      2
    );
  });
});

test('background shared state mutation: concurrent learning hit and review should not lose queue state', async () => {
  const storageState = {
    [WORD_STATS_V2_KEY]: {
      alpha: {
        word: 'alpha',
        translation: '阿尔法',
        level: 'CET4',
        sourceLevels: ['CET4'],
        exposureCount: 2,
        hitCount: 2,
        seenCount: 2,
        firstSeenAt: 1700000000000,
        lastSeenAt: 1700000000000,
        masteryScore: 30,
        status: 'seen',
        nextReviewBucket: 'today',
        intervalDays: 1,
        easeFactor: 2.3,
        nextReviewAt: 1700003600000,
      },
    },
    [REVIEW_QUEUE_KEY]: {
      alpha: {
        word: 'alpha',
        dueBucket: 'today',
        nextReviewAt: 1700003600000,
        intervalDays: 1,
        easeFactor: 2.3,
        updatedAt: 1700000000000,
        lastSeenAt: 1700000000000,
        sourceLevels: ['CET4'],
      },
    },
  };

  await withBackground(storageState, async ({ chrome, storageState: nextStorageState }) => {
    await Promise.all([
      sendRuntimeMessage(chrome, 'BILI_VOCAB_LEARNING_APPLY_REVIEW_FEEDBACK', {
        word: 'alpha',
        action: 'know',
        now: 1700000100000,
      }),
      sendRuntimeMessage(chrome, 'BILI_VOCAB_LEARNING_RECORD_HIT', {
        word: 'beta',
        translation: '贝塔',
        level: 'CET6',
        now: 1700000200000,
      }),
    ]);

    assert.equal(nextStorageState[WORD_STATS_V2_KEY].alpha.reviewCount, 1);
    assert.equal(nextStorageState[WORD_STATS_V2_KEY].beta.exposureCount, 1);
    assert.equal(nextStorageState[WORD_STATS_V2_KEY].beta.translation, '贝塔');
    assert.equal(nextStorageState[REVIEW_QUEUE_KEY].alpha.word, 'alpha');
    assert.equal(nextStorageState[REVIEW_QUEUE_KEY].beta.word, 'beta');
    assert.equal(nextStorageState[LEARNING_SUMMARY_KEY].queueCount, 2);
    assert.equal(nextStorageState[WORD_STATS_STORAGE_KEY].alpha.hitCount, 2);
    assert.equal(nextStorageState[WORD_STATS_STORAGE_KEY].beta.hitCount, 1);
  });
});
