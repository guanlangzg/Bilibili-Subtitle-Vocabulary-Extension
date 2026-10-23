const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const STORAGE_SOURCE = path.join(__dirname, '..', 'react-ui', 'src', 'lib', 'storage.ts');
const DASHBOARD_SOURCE = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'lib',
  'learning-dashboard.ts'
);
const LEARNING_STATE_SOURCE = path.join(__dirname, '..', 'learningState.js');

const WORD_STATS_KEY = 'bili_vocab_word_stats_v1';
const WORD_STATS_V2_KEY = 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_SUMMARY_KEY = 'bili_vocab_learning_summary_v1';

function transpile(fileName) {
  return ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createLearningStateSandbox() {
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    Promise,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(LEARNING_STATE_SOURCE, 'utf8'), sandbox, {
    filename: 'learningState.js',
  });
  return sandbox;
}

function createStorageModule(options = {}) {
  const storageState = cloneValue(options.initialState || {});
  const counters = { getCalls: 0, normalizeRecordCalls: 0, buildSummaryCalls: 0 };
  const runtime = { lastError: null };

  const learningStateSandbox = createLearningStateSandbox();
  const realLearningState = learningStateSandbox.LearningState;
  const countingLearningState = Object.create(realLearningState);
  countingLearningState.normalizeLearningRecord = function (...args) {
    counters.normalizeRecordCalls += 1;
    return realLearningState.normalizeLearningRecord(...args);
  };
  countingLearningState.buildLearningSummary = function (...args) {
    counters.buildSummaryCalls += 1;
    return realLearningState.buildLearningSummary(...args);
  };
  learningStateSandbox.LearningState = countingLearningState;

  const dashboardModule = { exports: {} };
  const dashboardSandbox = {
    module: dashboardModule,
    exports: dashboardModule.exports,
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
  };
  dashboardSandbox.globalThis = dashboardSandbox;
  vm.createContext(dashboardSandbox);
  vm.runInContext(transpile(DASHBOARD_SOURCE), dashboardSandbox, {
    filename: 'learning-dashboard.js',
  });

  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          counters.getCalls += 1;
          if (options.getImpl) {
            options.getImpl({ keys, callback, storageState, runtime });
            return;
          }
          if (keys == null) {
            callback(cloneValue(storageState));
            return;
          }
          const payload = {};
          for (const key of keys) payload[key] = cloneValue(storageState[key]);
          callback(payload);
        },
        set(payload, callback) {
          Object.assign(storageState, cloneValue(payload));
          if (typeof callback === 'function') callback();
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime,
  };

  const storageModule = { exports: {} };
  const sandbox = {
    module: storageModule,
    exports: storageModule.exports,
    chrome,
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    Promise,
    setTimeout,
    clearTimeout,
    LearningState: countingLearningState,
    require(id) {
      if (id === './settings-bridge') {
        return {
          SETTINGS_STORAGE_KEY_V3: 'bili_vocab_settings_v3',
          migrateToV3(value) {
            return value;
          },
          normalizeSettingsV3(value) {
            return value;
          },
        };
      }
      if (id === './chrome-storage-adapter') {
        return {
          readStorage(keys) {
            return new Promise((resolve, reject) => {
              chrome.storage.local.get(keys, (payload) => {
                if (runtime.lastError) {
                  reject(new Error(runtime.lastError.message));
                  return;
                }
                resolve(payload || {});
              });
            });
          },
          writeStorage(payload) {
            return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
          },
        };
      }
      if (id === './learning-dashboard') {
        return dashboardModule.exports;
      }
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
            ADAPTIVE_PERSIST_FEEDBACK: 'BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK',
            ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
            LEARNING_APPLY_REVIEW_FEEDBACK: 'BILI_VOCAB_LEARNING_APPLY_REVIEW_FEEDBACK',
            LEARNING_CLEAR_VOCABULARY: 'BILI_VOCAB_LEARNING_CLEAR_VOCABULARY',
          },
          hasRuntimeMessaging() {
            return true;
          },
          sendRuntimeMessage() {
            return Promise.reject(new Error('runtime messaging not stubbed'));
          },
        };
      }
      throw new Error(`unexpected require: ${id}`);
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transpile(STORAGE_SOURCE), sandbox, { filename: 'storage.js' });

  return { module: storageModule.exports, counters, storageState, runtime };
}

function buildStats(count, overrides = {}) {
  const stats = {};
  const base = 1760000000000;
  for (let index = 0; index < count; index += 1) {
    const word = `word${index}`;
    stats[word] = {
      word,
      translation: `释义${index}`,
      level: 'CET4',
      status: 'seen',
      exposureCount: (index % 9) + 1,
      hitCount: (index % 9) + 1,
      lastSeenAt: base + index,
      lastSeen: base + index,
      nextReviewAt: base + index * 1000,
      intervalDays: 3,
      easeFactor: 2.5,
      sourceLevels: ['CET4'],
    };
  }
  Object.assign(stats, overrides);
  return stats;
}

test('learning read paths: dashboard read normalizes only records referenced by the review queue', async () => {
  const stats = buildStats(2000);
  const queue = {
    word0: {
      word: 'word0',
      dueBucket: 'today',
      nextReviewAt: 1760000001000,
      updatedAt: 1760000001000,
    },
    word7: {
      word: 'word7',
      dueBucket: 'soon',
      nextReviewAt: 1760000002000,
      updatedAt: 1760000002000,
    },
    word14: {
      word: 'word14',
      dueBucket: 'later',
      nextReviewAt: 1760000003000,
      updatedAt: 1760000003000,
    },
  };
  const storedSummary = {
    todayCount: 1,
    newCount: 2000,
    masteredCount: 0,
    recentWords: [{ word: 'word0', status: 'seen' }],
  };
  const { module: storage, counters } = createStorageModule({
    initialState: {
      [WORD_STATS_V2_KEY]: stats,
      [WORD_STATS_KEY]: stats,
      [REVIEW_QUEUE_KEY]: queue,
      [LEARNING_SUMMARY_KEY]: storedSummary,
    },
  });

  const dashboard = await storage.readQuickReviewDashboard();

  assert.equal(counters.getCalls, 1);
  assert.equal(counters.normalizeRecordCalls, 3);
  assert.equal(counters.buildSummaryCalls, 0);
  assert.deepEqual(
    dashboard.items.map((item) => item.word),
    ['word0', 'word7', 'word14']
  );
  assert.deepEqual(
    dashboard.items.map((item) => item.dueBucket),
    ['today', 'soon', 'later']
  );
  assert.equal(dashboard.summary.todayCount, 1);
  assert.equal(dashboard.summary.newCount, 2000);
});

test('learning read paths: missing stored summary still rebuilds full statistics', async () => {
  const stats = buildStats(40);
  const queue = {
    word0: {
      word: 'word0',
      dueBucket: 'today',
      nextReviewAt: 1760000001000,
      updatedAt: 1760000001000,
    },
  };
  const { module: storage, counters } = createStorageModule({
    initialState: {
      [WORD_STATS_V2_KEY]: stats,
      [WORD_STATS_KEY]: stats,
      [REVIEW_QUEUE_KEY]: queue,
    },
  });

  const dashboard = await storage.readQuickReviewDashboard();

  assert.equal(counters.buildSummaryCalls, 1);
  // 40 records for the rebuilt summary, plus the single queued record for items.
  assert.equal(counters.normalizeRecordCalls, 41);
  assert.deepEqual(
    dashboard.items.map((item) => item.word),
    ['word0']
  );
  assert.equal(dashboard.summary.todayCount, 1);
  // All 40 fixture records are 'seen', so a full rebuild reports no unseen words.
  assert.equal(dashboard.summary.newCount, 0);
});

test('learning read paths: legacy v1 stats are still used when v2 is empty', async () => {
  const legacyStats = buildStats(12);
  const queue = {
    word3: {
      word: 'word3',
      dueBucket: 'today',
      nextReviewAt: 1760000001000,
      updatedAt: 1760000001000,
    },
  };
  const { module: storage } = createStorageModule({
    initialState: {
      [WORD_STATS_KEY]: legacyStats,
      [REVIEW_QUEUE_KEY]: queue,
      [LEARNING_SUMMARY_KEY]: { todayCount: 1, newCount: 12, masteredCount: 0, recentWords: [] },
    },
  });

  const dashboard = await storage.readQuickReviewDashboard();

  assert.deepEqual(
    dashboard.items.map((item) => item.word),
    ['word3']
  );
  assert.equal(dashboard.items[0].status, 'seen');
});

test('learning read paths: storage failures reject instead of returning empty data', async () => {
  const { module: storage } = createStorageModule({
    getImpl({ callback, runtime }) {
      runtime.lastError = { message: 'storage unavailable' };
      callback(undefined);
      runtime.lastError = null;
    },
  });

  await assert.rejects(() => storage.readQuickReviewDashboard(), /storage unavailable/);
});

test('learning read paths: ranking selects the same top entries as a full sort', async () => {
  const stats = {};
  const base = 1760000000000;
  // Mixed hit counts and lastSeen values, plus words that must be ignored.
  const spec = [
    ['alpha', 3, base + 10],
    ['beta', 3, base + 20],
    ['gamma', 1, base + 5],
    ['delta', 9, base + 1],
    ['epsilon', 5, base + 30],
    ['zeta', 0, base + 40],
    ['eta', 5, base + 20],
    ['theta', 2, base + 2],
  ];
  spec.forEach(([word, hitCount, lastSeen]) => {
    stats[word] = { word, translation: `t-${word}`, level: 'cet4', hitCount, lastSeen };
  });
  const { module: storage } = createStorageModule({
    initialState: { [WORD_STATS_KEY]: stats, [WORD_STATS_V2_KEY]: stats, [REVIEW_QUEUE_KEY]: {} },
  });

  const asc = await storage.readEncounteredWordRanking('asc', 4);
  assert.deepEqual(
    Array.from(asc, (item) => item.word),
    ['gamma', 'theta', 'alpha', 'beta']
  );
  assert.equal(asc[2].level, 'CET4');

  const desc = await storage.readEncounteredWordRanking('desc', 4);
  assert.deepEqual(
    Array.from(desc, (item) => item.word),
    ['delta', 'epsilon', 'eta', 'beta']
  );

  const all = await storage.readEncounteredWordRanking('asc', 50);
  assert.deepEqual(
    Array.from(all, (item) => item.word),
    ['gamma', 'theta', 'alpha', 'beta', 'eta', 'epsilon', 'delta']
  );
});
