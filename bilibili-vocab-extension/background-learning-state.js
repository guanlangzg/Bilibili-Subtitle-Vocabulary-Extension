(function (globalScope) {
  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);
  const backgroundStorage =
    globalScope.BackgroundStorage ||
    (typeof require === 'function' ? require('./background-storage.js') : null);

  const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
  const LEARNING_WORD_STATS_STORAGE_KEY =
    backgroundStorage && backgroundStorage.WORD_STATS_V2_KEY
      ? backgroundStorage.WORD_STATS_V2_KEY
      : learningState && learningState.STORAGE_KEYS
        ? learningState.STORAGE_KEYS.WORD_STATS_V2
        : 'bili_vocab_word_stats_v2';
  const REVIEW_QUEUE_STORAGE_KEY =
    backgroundStorage && backgroundStorage.REVIEW_QUEUE_KEY
      ? backgroundStorage.REVIEW_QUEUE_KEY
      : learningState && learningState.STORAGE_KEYS
        ? learningState.STORAGE_KEYS.REVIEW_QUEUE
        : 'bili_vocab_review_queue_v1';
  const LEARNING_SUMMARY_STORAGE_KEY =
    backgroundStorage && backgroundStorage.LEARNING_SUMMARY_KEY
      ? backgroundStorage.LEARNING_SUMMARY_KEY
      : learningState && learningState.STORAGE_KEYS
        ? learningState.STORAGE_KEYS.LEARNING_SUMMARY
        : 'bili_vocab_learning_summary_v1';

  const getStoragePayload = backgroundStorage && backgroundStorage.getStoragePayload;
  const setStoragePayload = backgroundStorage && backgroundStorage.setStoragePayload;
  const normalizeTimestamp = backgroundStorage && backgroundStorage.normalizeTimestamp;

  function normalizeWordKey(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function normalizeStatsMap(rawStats) {
    const source = rawStats && typeof rawStats === 'object' ? rawStats : {};
    const normalized = {};
    Object.keys(source).forEach((key) => {
      const item = source[key];
      if (!item || typeof item !== 'object') {
        return;
      }
      const word = normalizeWordKey(item.word || key);
      if (!word) {
        return;
      }
      normalized[word] =
        learningState && typeof learningState.normalizeLearningRecord === 'function'
          ? learningState.normalizeLearningRecord(item, {
              word,
              translation: item.translation || (item.details && item.details.meaning),
              level: item.level || (item.details && item.details.level),
            })
          : { ...item, word };
    });
    return normalized;
  }

  function migrateLegacyStats(rawStats) {
    const source = rawStats && typeof rawStats === 'object' ? rawStats : {};
    const normalized = {};
    Object.keys(source).forEach((key) => {
      const item = source[key];
      if (!item || typeof item !== 'object') {
        return;
      }
      const word = normalizeWordKey(item.word || key);
      if (!word) {
        return;
      }
      const migrated =
        learningState && typeof learningState.migrateLegacyStat === 'function'
          ? learningState.migrateLegacyStat(item)
          : item;
      normalized[word] =
        learningState && typeof learningState.normalizeLearningRecord === 'function'
          ? learningState.normalizeLearningRecord(migrated, { word })
          : { ...migrated, word };
    });
    return normalized;
  }

  function normalizeQueue(rawQueue) {
    if (learningState && typeof learningState.normalizeReviewQueue === 'function') {
      return learningState.normalizeReviewQueue(rawQueue);
    }
    return rawQueue && typeof rawQueue === 'object' ? rawQueue : {};
  }

  function buildSummary(stats, queue) {
    if (learningState && typeof learningState.buildLearningSummary === 'function') {
      return learningState.buildLearningSummary(stats, queue);
    }
    return {
      todayCount: 0,
      soonCount: 0,
      queueCount: Object.keys(queue || {}).length,
      unseenCount: 0,
      seenCount: Object.keys(stats || {}).length,
      savedCount: 0,
      masteredCount: 0,
      skippedCount: 0,
      newCount: 0,
      learningCount: 0,
      reviewingCount: 0,
      recentWords: [],
    };
  }

  function buildLegacyStats(stats) {
    const legacy = {};
    Object.keys(stats || {}).forEach((key) => {
      const record = stats[key];
      if (!record || typeof record !== 'object') {
        return;
      }
      legacy[key] = {
        ...record,
        hitCount: record.exposureCount || record.hitCount || 0,
        lastSeen: record.lastSeenAt || record.lastSeen || null,
      };
    });
    return legacy;
  }

  async function readLearningSnapshot() {
    if (!learningState) {
      throw new Error('LearningState unavailable');
    }
    if (typeof getStoragePayload !== 'function') {
      throw new Error('background storage unavailable');
    }

    const payload = await getStoragePayload([
      WORD_STATS_STORAGE_KEY,
      LEARNING_WORD_STATS_STORAGE_KEY,
      REVIEW_QUEUE_STORAGE_KEY,
      LEARNING_SUMMARY_STORAGE_KEY,
    ]);
    let stats = normalizeStatsMap(payload[LEARNING_WORD_STATS_STORAGE_KEY]);
    if (Object.keys(stats).length === 0) {
      stats = migrateLegacyStats(payload[WORD_STATS_STORAGE_KEY]);
    }
    const queue = normalizeQueue(payload[REVIEW_QUEUE_STORAGE_KEY]);
    return {
      stats,
      queue,
      summary: buildSummary(stats, queue),
    };
  }

  async function writeLearningSnapshot(stats, queue) {
    if (typeof setStoragePayload !== 'function') {
      throw new Error('background storage unavailable');
    }
    const summary = buildSummary(stats, queue);
    await setStoragePayload({
      [WORD_STATS_STORAGE_KEY]: buildLegacyStats(stats),
      [LEARNING_WORD_STATS_STORAGE_KEY]: stats,
      [REVIEW_QUEUE_STORAGE_KEY]: queue,
      [LEARNING_SUMMARY_STORAGE_KEY]: summary,
    });
    return { stats, queue, summary };
  }

  function normalizeHitPayload(messagePayload) {
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const record = payload.record && typeof payload.record === 'object' ? payload.record : {};
    const word = normalizeWordKey(payload.word || record.word);
    if (!word) {
      throw new Error('Learning hit word unavailable');
    }
    return {
      word,
      record,
      exposure: {
        word,
        translation: payload.translation || record.translation || record.meaning,
        level: payload.level || record.level,
        sourceLevels: payload.sourceLevels ||
          record.sourceLevels || [payload.level || record.level],
      },
      now:
        (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now(),
    };
  }

  async function recordLearningHit(messagePayload) {
    if (!learningState || typeof learningState.recordExposure !== 'function') {
      throw new Error('LearningState.recordExposure unavailable');
    }
    const hit = normalizeHitPayload(messagePayload);
    const snapshot = await readLearningSnapshot();
    const currentRecord = snapshot.stats[hit.word] || hit.record;
    const nextRecord = learningState.recordExposure(currentRecord, hit.exposure, hit.now);
    const nextStats = {
      ...snapshot.stats,
      [hit.word]: nextRecord,
    };
    const nextQueue =
      typeof learningState.syncReviewQueue === 'function'
        ? learningState.syncReviewQueue(snapshot.queue, nextRecord, hit.now)
        : snapshot.queue;
    return writeLearningSnapshot(nextStats, nextQueue);
  }

  async function applyReviewFeedback(messagePayload) {
    if (!learningState || typeof learningState.applyLearningAction !== 'function') {
      throw new Error('LearningState.applyLearningAction unavailable');
    }
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const word = normalizeWordKey(payload.word);
    if (!word) {
      throw new Error('Review word unavailable');
    }
    const action = String(payload.action || payload.feedback || '')
      .trim()
      .toLowerCase();
    if (!action) {
      throw new Error('Review feedback unavailable');
    }
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const snapshot = await readLearningSnapshot();
    const currentRecord = snapshot.stats[word];
    if (!currentRecord) {
      throw new Error('Review word unavailable');
    }
    const nextRecord = learningState.applyLearningAction(currentRecord, action, now);
    const nextStats = {
      ...snapshot.stats,
      [word]: nextRecord,
    };
    const nextQueue =
      typeof learningState.syncReviewQueue === 'function'
        ? learningState.syncReviewQueue(snapshot.queue, nextRecord, now)
        : snapshot.queue;
    const result = await writeLearningSnapshot(nextStats, nextQueue);
    return {
      ...result,
      word: String(nextRecord.word || word).trim(),
    };
  }

  async function saveWord(messagePayload) {
    if (!learningState || typeof learningState.buildSavedWordRecord !== 'function') {
      throw new Error('LearningState.buildSavedWordRecord unavailable');
    }
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const word = normalizeWordKey(payload.word);
    if (!word) {
      throw new Error('Save word unavailable');
    }
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    // Read the latest snapshot inside the background queue so this save merges
    // onto whatever hits/reviews landed meanwhile instead of rolling them back.
    const snapshot = await readLearningSnapshot();
    const nextRecord = learningState.buildSavedWordRecord(
      word,
      snapshot.stats[word] || null,
      payload.details,
      now
    );
    const nextStats = {
      ...snapshot.stats,
      [word]: nextRecord,
    };
    const nextQueue =
      typeof learningState.syncReviewQueue === 'function'
        ? learningState.syncReviewQueue(snapshot.queue, nextRecord, now)
        : snapshot.queue;
    const result = await writeLearningSnapshot(nextStats, nextQueue);
    return { saved: true, word, summary: result.summary };
  }

  async function removeWord(messagePayload) {
    if (!learningState || typeof learningState.buildRemovedWordRecord !== 'function') {
      throw new Error('LearningState.buildRemovedWordRecord unavailable');
    }
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const word = normalizeWordKey(payload.word);
    if (!word) {
      throw new Error('Remove word unavailable');
    }
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const snapshot = await readLearningSnapshot();
    const nextRecord = learningState.buildRemovedWordRecord(word, snapshot.stats[word], now);
    if (!nextRecord) {
      return { removed: false, word };
    }
    const nextStats = {
      ...snapshot.stats,
      [word]: nextRecord,
    };
    const nextQueue =
      typeof learningState.syncReviewQueue === 'function'
        ? learningState.syncReviewQueue(snapshot.queue, nextRecord, now)
        : snapshot.queue;
    const result = await writeLearningSnapshot(nextStats, nextQueue);
    return { removed: true, word, summary: result.summary };
  }

  async function clearVocabulary() {
    if (!learningState) {
      throw new Error('LearningState unavailable');
    }
    const snapshot = await readLearningSnapshot();
    const nextStats = { ...snapshot.stats };
    let clearedCount = 0;
    Object.keys(nextStats).forEach((key) => {
      const record = nextStats[key];
      if (!record || typeof record !== 'object' || record.status !== 'saved') {
        return;
      }
      // Mirror the legacy options-page clear: flip saved words back to seen and
      // rebuild the summary; the review queue is intentionally left untouched.
      // saveCount must be reset as well: deriveStatus promotes any record with
      // saveCount > 0 back to 'saved', so keeping it would undo the clear on the next hit.
      const nextRecord = { ...record, status: 'seen', saveCount: 0 };
      delete nextRecord.savedAt;
      nextStats[key] = nextRecord;
      clearedCount += 1;
    });
    if (clearedCount === 0) {
      return { cleared: 0 };
    }
    const result = await writeLearningSnapshot(nextStats, snapshot.queue);
    return { cleared: clearedCount, summary: result.summary };
  }

  const api = {
    WORD_STATS_STORAGE_KEY,
    LEARNING_WORD_STATS_STORAGE_KEY,
    REVIEW_QUEUE_STORAGE_KEY,
    LEARNING_SUMMARY_STORAGE_KEY,
    readLearningSnapshot,
    recordLearningHit,
    applyReviewFeedback,
    saveWord,
    removeWord,
    clearVocabulary,
  };

  globalScope.BackgroundLearningState = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
