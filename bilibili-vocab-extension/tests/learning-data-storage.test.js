const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const fixture = require('./fixtures/learning-data-v1.json');
const learningData = require('../learningData.js');

const WORD_STATS_KEY = 'bili_vocab_word_stats_v1';
const WORD_STATS_V2_KEY = 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_SUMMARY_KEY = 'bili_vocab_learning_summary_v1';
const LEARNING_DATA_KEY = 'bili_vocab_learning_data_v1';

const MODULE_PATHS = [
  '../learningState.js',
  '../learningData.js',
  '../background-learning-data.js',
  '../background-learning-state.js',
  '../background-storage.js',
  '../background-settings.js',
  '../background-message-handler.js',
  '../runtimeMessaging.js',
  '../sharedSettings.js',
  '../adaptiveTuning.js',
  '../experienceMetrics.js',
].map((relativePath) => require.resolve(relativePath));

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createChromeStub(initialState = {}, options = {}) {
  let storageState = clone(initialState);
  const runtime = { lastError: null, id: 'test-extension-id' };
  const setCalls = [];
  const stats = { getBytesInUseCalls: 0, setAttempts: 0 };
  return {
    runtime,
    setCalls,
    stats,
    get state() {
      return storageState;
    },
    storage: {
      local: {
        get(keys, callback) {
          runtime.lastError = null;
          if (keys == null) {
            callback(clone(storageState));
            return;
          }
          const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
          const payload = {};
          keyList.forEach((key) => {
            payload[key] = clone(storageState[key]);
          });
          callback(payload);
        },
        set(payload, callback) {
          stats.setAttempts += 1;
          const failure =
            typeof options.failSet === 'function'
              ? options.failSet(payload, stats.setAttempts)
              : null;
          if (failure) {
            runtime.lastError = { message: String(failure) };
            if (typeof callback === 'function') {
              callback();
            }
            runtime.lastError = null;
            return;
          }
          storageState = { ...storageState, ...clone(payload) };
          setCalls.push(clone(payload));
          runtime.lastError = null;
          if (typeof callback === 'function') {
            callback();
          }
        },
        getBytesInUse(_keys, callback) {
          stats.getBytesInUseCalls += 1;
          callback(JSON.stringify(storageState).length);
        },
      },
    },
  };
}

function loadBackgroundStack() {
  MODULE_PATHS.forEach((modulePath) => {
    delete require.cache[modulePath];
  });
  return {
    learningState: require('../learningState.js'),
    learningData: require('../learningData.js'),
    backgroundLearningData: require('../background-learning-data.js'),
    backgroundLearningState: require('../background-learning-state.js'),
    handler: require('../background-message-handler.js'),
    runtimeMessaging: require('../runtimeMessaging.js'),
  };
}

function sendMessageInBackgroundQueue(handler, type, payload) {
  return new Promise((resolve, reject) => {
    const handled = handler.handleBackgroundMessage(
      { type, payload },
      { id: 'test-extension-id' },
      (response) =>
        response && response.ok
          ? resolve(response.payload)
          : reject(new Error(String((response && response.error) || 'background message failed')))
    );
    assert.equal(handled, true);
  });
}

function withChrome(chromeStub, t) {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };
  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
    MODULE_PATHS.forEach((modulePath) => {
      delete require.cache[modulePath];
    });
  });
}

function legacyStats() {
  return {
    [WORD_STATS_V2_KEY]: {
      alpha: {
        word: 'alpha',
        translation: '阿尔法',
        level: 'CET4',
        sourceLevels: ['CET4'],
        status: 'seen',
        exposureCount: 3,
        hitCount: 3,
        seenCount: 3,
        firstSeenAt: 1000,
        lastSeenAt: 3000,
      },
    },
  };
}

function fsrsRecord() {
  return {
    word: 'state',
    translation: '状态',
    level: 'CET6',
    sourceLevels: ['CET6'],
    status: 'seen',
    exposureCount: 4,
    hitCount: 4,
    seenCount: 4,
    reviewCount: 2,
    saveCount: 1,
    saved: true,
    suspended: false,
    firstSeenAt: 1767139200000,
    lastSeenAt: 1767225599000,
    lastReviewedAt: 1767225602000,
    nextReviewAt: 1767484802000,
    intervalDays: 3,
    easeFactor: 2.3,
    schedule: {
      algorithm: 'fsrs',
      algorithmVersion: 'fsrs/java-fsrs-1.0.0',
      state: 'review',
      dueAt: 1767484802000,
      lastReviewedAt: 1767225602000,
      scheduledDays: 3,
      reviewCount: 3,
      lapseCount: 0,
      difficulty: 5,
      stability: 3.2,
      retrievability: 1,
      targetRetention: 0.9,
      legacyEaseFactor: null,
      legacyMasteryScore: null,
    },
  };
}

test('learning data storage: migration captures legacy stats once and is idempotent', async (t) => {
  const chromeStub = createChromeStub(legacyStats());
  withChrome(chromeStub, t);
  const { backgroundLearningState, backgroundLearningData } = loadBackgroundStack();

  const first = await backgroundLearningState.initializeLearningData();
  assert.equal(first.initialized, true);
  assert.equal(first.baselineCount, 1);
  assert.match(first.deviceId, /^[0-9a-f-]{36}$/);

  const stored = chromeStub.state[LEARNING_DATA_KEY];
  assert.equal(stored.legacyMigrated, true);
  assert.equal(stored.bundle.format, learningData.FORMAT);
  assert.equal(stored.bundle.schemaVersion, 1);
  assert.equal(stored.bundle.events.length, 0);
  const baseline = stored.bundle.baselines[0];
  assert.equal(baseline.word, 'alpha');
  assert.equal(baseline.exposureCount, 3);
  assert.equal(baseline.saved, false);
  assert.equal(baseline.schedule.algorithm, learningData.LEGACY_ALGORITHM);
  assert.equal(baseline.schedule.lastReviewedAt, null);

  const second = await backgroundLearningState.initializeLearningData();
  assert.equal(second.initialized, false);
  assert.equal(second.deviceId, first.deviceId);
  assert.equal(chromeStub.state[LEARNING_DATA_KEY].bundle.baselines.length, 1);
  assert.equal(backgroundLearningData.normalizeState(stored).deviceId, first.deviceId);
});

test('learning data storage: the first mutation captures baselines before its own event', async (t) => {
  const chromeStub = createChromeStub(legacyStats());
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const result = await backgroundLearningState.recordLearningHit({
    word: 'alpha',
    eventId: 'evt-hit-1',
    now: 5000,
  });

  assert.equal(result.word, 'alpha');
  const stored = chromeStub.state[LEARNING_DATA_KEY];
  assert.equal(stored.bundle.baselines.length, 1);
  // The baseline must not include the hit that triggered the migration.
  assert.equal(stored.bundle.baselines[0].exposureCount, 3);
  assert.equal(stored.bundle.events.length, 1);
  assert.equal(stored.bundle.events[0].type, 'exposure');
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.exposureCount, 4);
});

test('learning data storage: a hit reply carries only the acknowledgement fields', async (t) => {
  const chromeStub = createChromeStub(legacyStats());
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const result = await backgroundLearningState.recordLearningHit({
    word: 'alpha',
    eventId: 'evt-light-1',
    now: 5000,
  });
  assert.deepEqual(Object.keys(result).sort(), ['eventId', 'word']);
  assert.equal(result.word, 'alpha');
  assert.equal(result.eventId, 'evt-light-1');
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.exposureCount, 4);

  const retry = await backgroundLearningState.recordLearningHit({
    word: 'alpha',
    eventId: 'evt-light-1',
    now: 5000,
  });
  assert.deepEqual(Object.keys(retry).sort(), ['duplicate', 'eventId', 'word']);
  assert.equal(retry.duplicate, true);
});

test('learning data storage: a retried hit keeps the same id and never counts twice', async (t) => {
  const chromeStub = createChromeStub(legacyStats());
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  await backgroundLearningState.recordLearningHit({
    word: 'alpha',
    eventId: 'evt-retry',
    now: 5000,
  });
  const retry = await backgroundLearningState.recordLearningHit({
    word: 'alpha',
    eventId: 'evt-retry',
    now: 5000,
  });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.eventId, 'evt-retry');
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.exposureCount, 4);
  assert.equal(chromeStub.state[LEARNING_DATA_KEY].bundle.events.length, 1);

  await assert.rejects(
    backgroundLearningState.recordLearningHit({
      word: 'alpha',
      eventId: 'evt-retry',
      now: 6000,
    }),
    /Conflicting eventId/
  );
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.exposureCount, 4);
});

test('learning data storage: a failed set commits neither the bundle nor the projection', async (t) => {
  const chromeStub = createChromeStub(legacyStats(), {
    failSet: () => 'mock set failure',
  });
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  await assert.rejects(
    backgroundLearningState.recordLearningHit({ word: 'alpha', eventId: 'evt-fail', now: 5000 }),
    /mock set failure/
  );
  assert.equal(chromeStub.state[LEARNING_DATA_KEY], undefined);
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.exposureCount, 3);
});

test('learning data storage: quota failure rejects without running the cleanup path', async (t) => {
  const chromeStub = createChromeStub(legacyStats(), {
    failSet: () => 'QUOTA_BYTES quota exceeded',
  });
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  await assert.rejects(
    backgroundLearningState.recordLearningHit({ word: 'alpha', eventId: 'evt-quota', now: 5000 }),
    /quota/i
  );
  // Cleanup would read getBytesInUse and delete projection rows; the journal
  // write must bypass it so unsynced events are never pruned.
  assert.equal(chromeStub.stats.getBytesInUseCalls, 0);
  assert.equal(chromeStub.state[LEARNING_DATA_KEY], undefined);
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.exposureCount, 3);
});

test('learning data storage: importing the shared fixture projects contributions and keeps schedule separate', async (t) => {
  const chromeStub = createChromeStub();
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const result = await backgroundLearningState.importLearningData({ bundle: fixture });
  assert.equal(result.imported, true);

  const wordId = learningData.wordId('state');
  const progress = result.progress[wordId];
  assert.deepEqual(
    [progress.exposureCount, progress.lookupCount, progress.reviewCount, progress.saveCount],
    [8, 2, 3, 1]
  );
  assert.deepEqual(progress.contributions.extension, {
    exposureCount: 8,
    lookupCount: 2,
    reviewCount: 2,
    saveCount: 1,
  });
  assert.deepEqual(progress.contributions.android, {
    exposureCount: 0,
    lookupCount: 0,
    reviewCount: 1,
    saveCount: 0,
  });

  const record = chromeStub.state[WORD_STATS_V2_KEY].state;
  assert.equal(record.exposureCount, 8);
  assert.equal(record.lookupCount, 2);
  assert.equal(record.reviewCount, 3);
  assert.equal(record.saved, false);
  assert.equal(record.suspended, false);
  assert.deepEqual(record.bookCodes, ['CET4', 'CET6']);
  // FSRS lives only in schedule; easeFactor stays a legacy display field.
  assert.equal(record.schedule.algorithm, 'fsrs');
  assert.equal(record.schedule.dueAt, 1767484802000);
  assert.equal(record.nextReviewAt, 1767484802000);
  assert.notEqual(record.easeFactor, record.schedule.stability);
  assert.notEqual(record.easeFactor, record.schedule.difficulty);

  // A fresh install must not copy incoming baselines into a local baseline.
  const stored = chromeStub.state[LEARNING_DATA_KEY];
  assert.equal(stored.bundle.baselines.length, 1);
  assert.equal(stored.bundle.baselines[0].deviceId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.notEqual(stored.bundle.baselines[0].deviceId, stored.deviceId);
});

test('learning data storage: repeated imports keep one legacy baseline and stay idempotent', async (t) => {
  const chromeStub = createChromeStub(legacyStats());
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  await backgroundLearningState.initializeLearningData();
  assert.equal(chromeStub.state[LEARNING_DATA_KEY].bundle.baselines.length, 1);

  await backgroundLearningState.importLearningData({ bundle: fixture });
  assert.equal(chromeStub.state[LEARNING_DATA_KEY].bundle.baselines.length, 2);
  const afterFirst = clone(chromeStub.state[LEARNING_DATA_KEY]);

  const second = await backgroundLearningState.importLearningData({ bundle: fixture });
  assert.equal(second.imported, true);
  const afterSecond = chromeStub.state[LEARNING_DATA_KEY];
  // Only exportedAt is refreshed; rows stay byte-identical.
  assert.deepEqual(afterSecond.bundle.events, afterFirst.bundle.events);
  assert.deepEqual(afterSecond.bundle.baselines, afterFirst.bundle.baselines);
  assert.equal(afterSecond.bundle.baselines.length, 2);
  assert.equal(afterSecond.bundle.events.length, 4);
});

test('learning data storage: imports reject unknown schemas and conflicting ids without writing', async (t) => {
  const chromeStub = createChromeStub();
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  await assert.rejects(
    backgroundLearningState.importLearningData({
      bundle: { ...clone(fixture), schemaVersion: 2 },
    }),
    /Unsupported/
  );
  assert.equal(chromeStub.stats.setAttempts, 0);

  await backgroundLearningState.importLearningData({ bundle: fixture });
  const beforeConflict = clone(chromeStub.state[LEARNING_DATA_KEY]);
  const conflict = clone(fixture);
  conflict.events[1].rating = 'again';

  await assert.rejects(
    backgroundLearningState.importLearningData({ bundle: conflict }),
    /Conflicting eventId/
  );
  assert.deepEqual(chromeStub.state[LEARNING_DATA_KEY], beforeConflict);
});

test('learning data storage: unknown words survive import, projection and export', async (t) => {
  const chromeStub = createChromeStub();
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const event = learningData.createEvent({
    ...fixture.events[0],
    eventId: 'evt-unknown',
    word: 'out-of-dataset',
    bookCodes: [],
  });
  const bundle = {
    format: learningData.FORMAT,
    schemaVersion: 1,
    exportedAt: 1767225603000,
    events: [event],
    baselines: [],
  };
  await backgroundLearningState.importLearningData({ bundle });
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY]['out-of-dataset'].exposureCount, 1);

  const exported = await backgroundLearningState.exportLearningData({ now: 1767225604000 });
  assert.ok(exported.bundle.events.some((row) => row.word === 'out-of-dataset'));
  assert.equal(exported.progress[learningData.wordId('out-of-dataset')].exposureCount, 1);
});

test('learning data storage: clear records one unsave per saved word and retries safely', async (t) => {
  const savedRecord = (word, at) => ({
    word,
    status: 'saved',
    saved: true,
    saveCount: 1,
    exposureCount: 2,
    lastSeenAt: at,
    savedAt: at,
  });
  const chromeStub = createChromeStub({
    [WORD_STATS_V2_KEY]: {
      alpha: savedRecord('alpha', 1000),
      beta: savedRecord('beta', 2000),
      gamma: savedRecord('gamma', 3000),
    },
  });
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const cleared = await backgroundLearningState.clearVocabulary({
    commandId: 'clear-1',
    now: 9000,
  });
  assert.equal(cleared.cleared, 3);
  const events = chromeStub.state[LEARNING_DATA_KEY].bundle.events;
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => event.type),
    ['unsave', 'unsave', 'unsave']
  );
  assert.deepEqual(events.map((event) => event.word).sort(), ['alpha', 'beta', 'gamma']);
  assert.equal(new Set(events.map((event) => event.eventId)).size, 3);
  Object.values(chromeStub.state[WORD_STATS_V2_KEY]).forEach((record) => {
    assert.equal(record.saved, false);
    assert.equal(record.status, 'seen');
    assert.equal(record.saveCount, 0);
  });

  const retried = await backgroundLearningState.clearVocabulary({
    commandId: 'clear-1',
    now: 9000,
  });
  assert.equal(retried.cleared, 0);
  assert.equal(chromeStub.state[LEARNING_DATA_KEY].bundle.events.length, 3);
});

test('learning data storage: a legacy baseline invents no review events', async (t) => {
  const chromeStub = createChromeStub({
    [WORD_STATS_V2_KEY]: {
      alpha: {
        word: 'alpha',
        status: 'mastered',
        exposureCount: 9,
        reviewCount: 4,
        saveCount: 1,
        lastReviewedAt: 5000,
        nextReviewAt: 9000,
        intervalDays: 2,
        easeFactor: 2.4,
        masteryScore: 80,
      },
    },
  });
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const result = await backgroundLearningState.initializeLearningData();
  assert.equal(result.initialized, true);
  const stored = chromeStub.state[LEARNING_DATA_KEY];
  assert.equal(stored.bundle.events.length, 0);
  assert.equal(stored.bundle.baselines[0].reviewCount, 4);
  assert.equal(stored.bundle.baselines[0].schedule.lastReviewedAt, 5000);
  // Only the saved status maps to the saved flag; saveCount is still preserved.
  assert.equal(stored.bundle.baselines[0].saved, false);
  assert.equal(stored.bundle.baselines[0].saveCount, 1);
});

test('learning data storage: reviews on an FSRS record stay pending instead of faking a schedule', async (t) => {
  const chromeStub = createChromeStub({
    [WORD_STATS_V2_KEY]: { state: fsrsRecord() },
  });
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const result = await backgroundLearningState.applyReviewFeedback({
    word: 'state',
    action: 'good',
    eventId: 'evt-fsrs-review',
    now: 1767225700000,
  });

  assert.equal(result.pendingScheduling, true);
  assert.equal(result.scheduleUpdated, false);
  assert.equal(result.algorithm, 'extension-pending');
  const record = chromeStub.state[WORD_STATS_V2_KEY].state;
  assert.equal(record.reviewCount, 3);
  assert.equal(record.schedule.algorithm, 'fsrs');
  assert.equal(record.schedule.dueAt, 1767484802000);
  assert.equal(record.saved, true);
  const event = chromeStub.state[LEARNING_DATA_KEY].bundle.events[0];
  assert.equal(event.type, 'review');
  assert.equal(event.rating, 'good');
  assert.equal(event.algorithm, 'extension-pending');
  assert.equal(event.schedule, null);
});

test('learning data storage: an exposure keeps the FSRS due date intact', async (t) => {
  const chromeStub = createChromeStub({
    [WORD_STATS_V2_KEY]: { state: fsrsRecord() },
  });
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  await backgroundLearningState.recordLearningHit({
    word: 'state',
    eventId: 'evt-fsrs-exposure',
    now: 1767225700000,
  });

  const record = chromeStub.state[WORD_STATS_V2_KEY].state;
  assert.equal(record.exposureCount, 5);
  assert.equal(record.schedule.algorithm, 'fsrs');
  assert.equal(record.schedule.dueAt, 1767484802000);
  assert.equal(record.nextReviewAt, 1767484802000);
  assert.equal(chromeStub.state[LEARNING_DATA_KEY].bundle.events[0].schedule, null);
});

test('learning data storage: a legacy review writes an explicit extension-interval snapshot', async (t) => {
  const chromeStub = createChromeStub(legacyStats());
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  const result = await backgroundLearningState.applyReviewFeedback({
    word: 'alpha',
    action: 'know',
    eventId: 'evt-legacy-review',
    now: 5000,
  });

  assert.equal(result.pendingScheduling, false);
  assert.equal(result.scheduleUpdated, true);
  const event = chromeStub.state[LEARNING_DATA_KEY].bundle.events[0];
  assert.equal(event.type, 'review');
  assert.equal(event.rating, 'good');
  assert.equal(event.rawAction, 'know');
  assert.equal(event.algorithm, learningData.LEGACY_ALGORITHM);
  assert.equal(event.schedule.algorithm, learningData.LEGACY_ALGORITHM);
  assert.equal(event.schedule.lastReviewedAt, 5000);
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.reviewCount, 1);
});

test('learning data storage: lookup counts only through the explicit message and is deduplicated', async (t) => {
  const chromeStub = createChromeStub(legacyStats());
  withChrome(chromeStub, t);
  const { backgroundLearningState, handler, runtimeMessaging } = loadBackgroundStack();

  const first = await sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_RECORD_LOOKUP,
    { word: 'alpha', eventId: 'evt-lookup', now: 5000, context: '原句', level: 'CET4' }
  );
  assert.equal(first.lookupCount, 1);

  const retry = await sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_RECORD_LOOKUP,
    { word: 'alpha', eventId: 'evt-lookup', now: 5000, context: '原句', level: 'CET4' }
  );
  assert.equal(retry.duplicate, true);
  assert.equal(chromeStub.state[WORD_STATS_V2_KEY].alpha.lookupCount, 1);
  const event = chromeStub.state[LEARNING_DATA_KEY].bundle.events[0];
  assert.equal(event.type, 'lookup');
  assert.equal(event.context.sentence, '原句');
});

test('learning data storage: export and import are available through trusted background messages', async (t) => {
  const chromeStub = createChromeStub();
  withChrome(chromeStub, t);
  const { handler, runtimeMessaging } = loadBackgroundStack();

  const exported = await sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_EXPORT_DATA,
    { now: 1767225603000 }
  );
  assert.equal(exported.bundle.format, learningData.FORMAT);
  assert.equal(exported.pendingEventCount, 0);
  assert.equal(typeof exported.deviceId, 'string');

  const imported = await sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_IMPORT_DATA,
    { bundle: fixture, now: 1767225604000 }
  );
  assert.equal(imported.imported, true);
  assert.equal(imported.progress[learningData.wordId('state')].exposureCount, 8);
});

test('learning data storage: unsupported states are rejected instead of silently reset', async (t) => {
  const chromeStub = createChromeStub({
    [LEARNING_DATA_KEY]: {
      deviceId: 'device-test',
      legacyMigrated: true,
      bundle: {
        format: learningData.FORMAT,
        schemaVersion: 7,
        exportedAt: 0,
        events: [],
        baselines: [],
      },
    },
  });
  withChrome(chromeStub, t);
  const { backgroundLearningState } = loadBackgroundStack();

  await assert.rejects(
    backgroundLearningState.recordLearningHit({ word: 'alpha', eventId: 'evt-x', now: 5000 }),
    /Invalid learning data state/
  );
  assert.equal(chromeStub.stats.setAttempts, 0);
  assert.equal(chromeStub.state[LEARNING_DATA_KEY].bundle.schemaVersion, 7);
});

test('learning data storage: storage key used by the background matches the protocol', () => {
  const modulePath = path.join(__dirname, '..', 'background-learning-data.js');
  assert.equal(require(modulePath).STORAGE_KEY, learningData.STORAGE_KEY);
  assert.equal(LEARNING_DATA_KEY, learningData.STORAGE_KEY);
  assert.equal(LEARNING_SUMMARY_KEY, 'bili_vocab_learning_summary_v1');
  assert.equal(WORD_STATS_KEY, 'bili_vocab_word_stats_v1');
  assert.equal(REVIEW_QUEUE_KEY, 'bili_vocab_review_queue_v1');
});
