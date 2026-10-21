const test = require('node:test');
const assert = require('node:assert/strict');

const learningStatePath = require.resolve('../learningState.js');
const backgroundLearningStatePath = require.resolve('../background-learning-state.js');
const backgroundMessageHandlerPath = require.resolve('../background-message-handler.js');
const backgroundStoragePath = require.resolve('../background-storage.js');
const runtimeMessagingPath = require.resolve('../runtimeMessaging.js');
const sharedSettingsPath = require.resolve('../sharedSettings.js');
const adaptiveTuningPath = require.resolve('../adaptiveTuning.js');
const experienceMetricsPath = require.resolve('../experienceMetrics.js');

const WORD_STATS_KEY = 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_SUMMARY_KEY = 'bili_vocab_learning_summary_v1';

function createChromeStub(initialState = {}) {
  let storageState = { ...initialState };
  const runtime = { lastError: null, id: 'test-extension-id' };
  const sentMessages = [];
  const setCalls = [];
  return {
    runtime,
    sentMessages,
    setCalls,
    get state() {
      return storageState;
    },
    storage: {
      local: {
        get(_keys, callback) {
          runtime.lastError = null;
          callback({ ...storageState });
        },
        set(payload, callback) {
          storageState = { ...storageState, ...payload };
          setCalls.push(payload);
          runtime.lastError = null;
          callback();
        },
      },
    },
  };
}

function loadBackgroundStack() {
  [
    learningStatePath,
    backgroundLearningStatePath,
    backgroundMessageHandlerPath,
    backgroundStoragePath,
    runtimeMessagingPath,
    sharedSettingsPath,
    adaptiveTuningPath,
    experienceMetricsPath,
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });
  return {
    learningState: require('../learningState.js'),
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
          : reject(
              new Error(
                String(response && response.error ? response.error : 'background message failed')
              )
            )
    );
    assert.equal(handled, true);
  });
}

test('background saveWord merges onto the latest snapshot and keeps concurrent hits', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const chromeStub = createChromeStub({
    [WORD_STATS_KEY]: {
      alpha: { word: 'alpha', status: 'seen', exposureCount: 5, hitCount: 5, lastSeenAt: 1000 },
    },
  });
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const { backgroundLearningState } = loadBackgroundStack();

  const result = await backgroundLearningState.saveWord({
    word: 'Beta',
    details: { meaning: '测试释义', level: 'CET6' },
    now: 1700000000000,
  });

  assert.equal(result.saved, true);

  const stats = chromeStub.state[WORD_STATS_KEY];
  // The save must not roll back the record written by another context.
  assert.equal(stats.alpha.exposureCount, 5);
  assert.equal(stats.beta.status, 'saved');
  assert.equal(stats.beta.details.meaning, '测试释义');
  assert.equal(stats.beta.word, 'beta');
  assert.ok(chromeStub.state[LEARNING_SUMMARY_KEY]);
});

test('background queue serializes a hit and a save without losing either update', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const chromeStub = createChromeStub({
    [WORD_STATS_KEY]: {
      alpha: { word: 'alpha', status: 'seen', exposureCount: 5, hitCount: 5, lastSeenAt: 1000 },
    },
  });
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const { handler, runtimeMessaging } = loadBackgroundStack();

  // Both messages race into the shared queue; it must serialize them so the
  // full-snapshot writes never overwrite each other.
  const hitPromise = sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_RECORD_HIT,
    { word: 'alpha', now: 1700000001000 }
  );
  const savePromise = sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_SAVE_WORD,
    { word: 'beta', details: { meaning: '并发收藏' }, now: 1700000002000 }
  );
  await Promise.all([hitPromise, savePromise]);

  const stats = chromeStub.state[WORD_STATS_KEY];
  assert.equal(stats.alpha.exposureCount, 6);
  assert.equal(stats.beta.status, 'saved');
});

test('background removeWord unsaves only saved words and reports misses', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const chromeStub = createChromeStub({
    [WORD_STATS_KEY]: {
      alpha: {
        word: 'alpha',
        status: 'saved',
        saveCount: 2,
        exposureCount: 3,
        savedAt: 1700000000000,
      },
      beta: { word: 'beta', status: 'seen', exposureCount: 1 },
    },
  });
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const { backgroundLearningState } = loadBackgroundStack();

  const removed = await backgroundLearningState.removeWord({ word: 'alpha', now: 1700000001000 });
  assert.equal(removed.removed, true);
  assert.equal(chromeStub.state[WORD_STATS_KEY].alpha.status, 'seen');
  assert.equal(chromeStub.state[WORD_STATS_KEY].alpha.savedAt, undefined);
  assert.equal(chromeStub.state[WORD_STATS_KEY].alpha.saveCount, 1);

  const missed = await backgroundLearningState.removeWord({ word: 'beta', now: 1700000002000 });
  assert.equal(missed.removed, false);
  assert.equal(chromeStub.state[WORD_STATS_KEY].beta.status, 'seen');
});

test('background clearVocabulary flips saved words only and leaves others untouched', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const chromeStub = createChromeStub({
    [WORD_STATS_KEY]: {
      alpha: { word: 'alpha', status: 'saved', savedAt: 1700000000000, exposureCount: 2 },
      beta: { word: 'beta', status: 'seen', exposureCount: 1 },
      gamma: { word: 'gamma', status: 'saved', savedAt: 1700000001000, exposureCount: 4 },
    },
    [REVIEW_QUEUE_KEY]: { alpha: { word: 'alpha' } },
  });
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const { handler, runtimeMessaging } = loadBackgroundStack();
  const cleared = await sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_CLEAR_VOCABULARY,
    {}
  );

  assert.equal(cleared.cleared, 2);
  const stats = chromeStub.state[WORD_STATS_KEY];
  assert.equal(stats.alpha.status, 'seen');
  assert.equal(stats.alpha.savedAt, undefined);
  assert.equal(stats.gamma.status, 'seen');
  assert.equal(stats.beta.status, 'seen');
  // The review queue keeps its entry (normalized shape), matching the legacy clear.
  assert.deepEqual(Object.keys(chromeStub.state[REVIEW_QUEUE_KEY]), ['alpha']);
  assert.equal(chromeStub.state[REVIEW_QUEUE_KEY].alpha.word, 'alpha');
  assert.ok(chromeStub.state[LEARNING_SUMMARY_KEY]);
});

test('page saveWordToVocabularyBook routes through the background and skips full-map writes', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const previousRuntimeMessaging = globalThis.RuntimeMessaging;
  const chromeStub = createChromeStub();
  chromeStub.runtime.sendMessage = (message, callback) => {
    chromeStub.sentMessages.push(message);
    callback({ ok: true, payload: { saved: true } });
  };
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
    if (previousRuntimeMessaging === undefined) {
      delete globalThis.RuntimeMessaging;
    } else {
      globalThis.RuntimeMessaging = previousRuntimeMessaging;
    }
  });

  const { learningState } = loadBackgroundStack();
  globalThis.RuntimeMessaging = require('../runtimeMessaging.js');

  const success = await learningState.saveWordToVocabularyBook('beta', { meaning: '消息路径' });
  assert.equal(success, true);
  assert.equal(chromeStub.sentMessages.length, 1);
  assert.equal(chromeStub.sentMessages[0].type, 'BILI_VOCAB_LEARNING_SAVE_WORD');
  assert.equal(chromeStub.sentMessages[0].payload.word, 'beta');
  // The page must never write the shared keys directly anymore.
  const sharedKeyWrites = chromeStub.setCalls.filter((payload) => payload[WORD_STATS_KEY]);
  assert.equal(sharedKeyWrites.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('page removeWordFromVocabularyBook falls back to local write without messaging', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const chromeStub = createChromeStub({
    [WORD_STATS_KEY]: {
      alpha: { word: 'alpha', status: 'saved', saveCount: 1, exposureCount: 1, savedAt: 100 },
    },
  });
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const { learningState } = loadBackgroundStack();
  const removed = await learningState.removeWordFromVocabularyBook('alpha');
  assert.equal(removed, true);
  assert.equal(chromeStub.state[WORD_STATS_KEY].alpha.status, 'seen');
});

test('cleared words should not return to the saved book on the next exposure', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const chromeStub = createChromeStub({
    [WORD_STATS_KEY]: {
      alpha: {
        word: 'alpha',
        status: 'saved',
        savedAt: 1700000000000,
        saveCount: 1,
        exposureCount: 2,
      },
    },
  });
  globalThis.chrome = chromeStub;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const { handler, runtimeMessaging } = loadBackgroundStack();
  await sendMessageInBackgroundQueue(
    handler,
    runtimeMessaging.MESSAGE_TYPES.LEARNING_CLEAR_VOCABULARY,
    {}
  );

  assert.equal(chromeStub.state[WORD_STATS_KEY].alpha.saveCount, 0);

  await sendMessageInBackgroundQueue(handler, runtimeMessaging.MESSAGE_TYPES.LEARNING_RECORD_HIT, {
    word: 'alpha',
    now: 1700000005000,
  });

  assert.equal(chromeStub.state[WORD_STATS_KEY].alpha.status, 'seen');
});
