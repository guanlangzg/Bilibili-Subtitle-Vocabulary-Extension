(function (globalScope) {
  // Dependencies are loaded by background.js importScripts before this module.
  // In Node tests, require() provides the same modules.

  const backgroundSettings =
    globalScope.BackgroundSettings ||
    (typeof require === 'function' ? require('./background-settings.js') : null);

  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);

  const sharedSettings = backgroundSettings && backgroundSettings.sharedSettings;

  // Legacy storage keys retained for backward compatibility with existing installs.
  const SETTINGS_STORAGE_KEY_V3 =
    sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
      ? sharedSettings.SETTINGS_STORAGE_KEY_V3
      : 'bili_vocab_settings_v3';

  const WORD_STATS_V2_KEY = 'bili_vocab_word_stats_v2';
  const REVIEW_QUEUE_KEY = 'bili_vocab_review_queue_v1';
  const LEARNING_SUMMARY_KEY = 'bili_vocab_learning_summary_v1';
  const MAX_STORAGE_SIZE_BYTES = 10 * 1024 * 1024;
  const STORAGE_WARNING_THRESHOLD = 0.8;
  const STORAGE_CHECK_INTERVAL_MS = 60 * 1000;
  let lastStorageCheckAt = 0;
  const STALE_LOW_VALUE_WORD_MS = 90 * 24 * 60 * 60 * 1000;

  function getChromeRuntimeError() {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return null;
    }

    const runtimeError = chrome.runtime.lastError;
    if (!runtimeError) {
      return null;
    }

    const message = String(runtimeError.message || '').trim();
    return new Error(message || 'Chrome runtime error');
  }

  function logBackgroundError(context, error) {
    if (typeof console === 'undefined' || typeof console.error !== 'function') {
      return;
    }

    console.error(`[BiliVocab] ${context}:`, error);
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    return Math.floor(timestamp);
  }

  function normalizeStorageWordKey(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function normalizeStorageCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
      return 0;
    }
    return Math.floor(count);
  }

  function normalizeLearningStatus(value) {
    const normalized = String(value || 'unseen')
      .trim()
      .toLowerCase();
    return ['unseen', 'seen', 'saved', 'mastered', 'skipped'].includes(normalized)
      ? normalized
      : 'unseen';
  }

  function normalizeReviewBucket(value) {
    const normalized = String(value || 'today')
      .trim()
      .toLowerCase();
    return ['today', 'soon', 'later'].includes(normalized) ? normalized : 'today';
  }

  function getLatestLearningActivityAt(entry) {
    return Math.max(
      normalizeTimestamp(entry && entry.lastSeenAt) || 0,
      normalizeTimestamp(entry && entry.lastSeen) || 0,
      normalizeTimestamp(entry && entry.updatedAt) || 0,
      normalizeTimestamp(entry && entry.lastReviewedAt) || 0,
      normalizeTimestamp(entry && entry.savedAt) || 0
    );
  }

  function getLearningExposureCount(entry) {
    return Math.max(
      normalizeStorageCount(entry && entry.hitCount),
      normalizeStorageCount(entry && entry.exposureCount),
      normalizeStorageCount(entry && entry.seenCount),
      normalizeStorageCount(entry && entry.exposures)
    );
  }

  function isProtectedLearningRecord(entry) {
    const status = normalizeLearningStatus(entry && (entry.status || entry.learningStatus));
    if (['saved', 'mastered', 'skipped'].includes(status)) {
      return true;
    }

    return (
      normalizeTimestamp(entry && entry.savedAt) != null ||
      normalizeTimestamp(entry && entry.lastReviewedAt) != null ||
      normalizeStorageCount(entry && entry.saveCount) > 0 ||
      normalizeStorageCount(entry && entry.reviewCount) > 0
    );
  }

  function shouldKeepLearningRecord(entry, now = Date.now()) {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    if (isProtectedLearningRecord(entry)) {
      return true;
    }

    if (getLearningExposureCount(entry) > 1) {
      return true;
    }

    const lastActivityAt = getLatestLearningActivityAt(entry);
    return lastActivityAt > 0 && now - lastActivityAt <= STALE_LOW_VALUE_WORD_MS;
  }

  function buildCleanedReviewQueue(queue, removedWords) {
    if (!queue || typeof queue !== 'object') {
      return {};
    }

    const nextQueue = {};
    Object.keys(queue).forEach((key) => {
      const normalizedKey = normalizeStorageWordKey(key);
      if (removedWords.has(key) || removedWords.has(normalizedKey)) {
        return;
      }
      nextQueue[key] = queue[key];
    });
    return nextQueue;
  }

  function buildCleanedLearningSummary(records, queue) {
    // Keep one summary implementation: cleanup must not emit values the runtime would not.
    if (learningState && typeof learningState.buildLearningSummary === 'function') {
      return learningState.buildLearningSummary(records, queue);
    }

    const recordMap = records && typeof records === 'object' ? records : {};
    const queueMap = queue && typeof queue === 'object' ? queue : {};
    const summary = {
      todayCount: 0,
      soonCount: 0,
      queueCount: Object.keys(queueMap).length,
      unseenCount: 0,
      seenCount: 0,
      savedCount: 0,
      masteredCount: 0,
      skippedCount: 0,
      newCount: 0,
      learningCount: 0,
      reviewingCount: 0,
      recentWords: [],
    };

    const recentWords = [];
    Object.keys(recordMap).forEach((key) => {
      const entry = recordMap[key];
      if (!entry || typeof entry !== 'object') {
        return;
      }

      const word = normalizeStorageWordKey(entry.word || key);
      if (!word) {
        return;
      }

      const status = normalizeLearningStatus(entry.status || entry.learningStatus);
      if (status === 'unseen') summary.unseenCount += 1;
      if (status === 'seen') summary.seenCount += 1;
      if (status === 'saved') summary.savedCount += 1;
      if (status === 'mastered') summary.masteredCount += 1;
      if (status === 'skipped') summary.skippedCount += 1;

      recentWords.push({
        word,
        status,
        lastSeenAt: normalizeTimestamp(entry.lastSeenAt || entry.lastSeen),
        nextReviewBucket: normalizeReviewBucket(entry.nextReviewBucket),
        nextReviewAt: normalizeTimestamp(entry.nextReviewAt),
        intervalDays: Math.max(1, normalizeStorageCount(entry.intervalDays) || 1),
        easeFactor: Number(entry.easeFactor) || 2.3,
      });
    });

    Object.values(queueMap).forEach((item) => {
      const bucket = normalizeReviewBucket(item && item.dueBucket);
      if (bucket === 'today') summary.todayCount += 1;
      if (bucket === 'soon') summary.soonCount += 1;
    });

    summary.newCount = summary.unseenCount;
    summary.learningCount = summary.seenCount;
    summary.reviewingCount = summary.savedCount;
    summary.recentWords = recentWords
      .sort((left, right) => (right.lastSeenAt || 0) - (left.lastSeenAt || 0))
      .slice(0, 5);

    return summary;
  }

  function buildLearningDataCleanupPatch(storagePayload, now = Date.now()) {
    const wordStats = storagePayload && storagePayload[WORD_STATS_V2_KEY];
    if (!wordStats || typeof wordStats !== 'object') {
      return null;
    }

    const cleanedStats = {};
    const removedWords = new Set();
    Object.keys(wordStats).forEach((key) => {
      const entry = wordStats[key];
      if (shouldKeepLearningRecord(entry, now)) {
        cleanedStats[key] = entry;
        return;
      }
      removedWords.add(key);
      removedWords.add(normalizeStorageWordKey(entry && entry.word));
    });

    if (removedWords.size === 0) {
      return null;
    }

    const nextQueue = buildCleanedReviewQueue(storagePayload[REVIEW_QUEUE_KEY], removedWords);
    return {
      removedCount: Object.keys(wordStats).length - Object.keys(cleanedStats).length,
      beforeCount: Object.keys(wordStats).length,
      afterCount: Object.keys(cleanedStats).length,
      payload: {
        [WORD_STATS_V2_KEY]: cleanedStats,
        [REVIEW_QUEUE_KEY]: nextQueue,
        [LEARNING_SUMMARY_KEY]: buildCleanedLearningSummary(cleanedStats, nextQueue),
      },
    };
  }

  function isStorageQuotaError(error) {
    const message = String((error && error.message) || error || '').toLowerCase();
    return message.includes('quota') || message.includes('exceed');
  }

  function writeStoragePayload(payload) {
    return new Promise((resolve, reject) => {
      if (
        typeof chrome === 'undefined' ||
        !chrome.storage ||
        !chrome.storage.local ||
        typeof chrome.storage.local.set !== 'function'
      ) {
        reject(new Error('chrome.storage.local.set unavailable'));
        return;
      }

      chrome.storage.local.set(payload, () => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        resolve();
      });
    });
  }

  function getStoragePayload(keys) {
    return new Promise((resolve, reject) => {
      if (
        typeof chrome === 'undefined' ||
        !chrome.storage ||
        !chrome.storage.local ||
        typeof chrome.storage.local.get !== 'function'
      ) {
        reject(new Error('chrome.storage.local.get unavailable'));
        return;
      }

      chrome.storage.local.get(keys || null, (payload) => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        resolve(payload || {});
      });
    });
  }

  function logBackgroundInfo(context, info) {
    if (typeof console === 'undefined' || typeof console.info !== 'function') {
      return;
    }
    console.info(`[BiliVocab] ${context}:`, info);
  }

  async function tryCleanOldLearningData() {
    try {
      const currentStorage = await getStoragePayload(null);
      const cleanupPatch = buildLearningDataCleanupPatch(currentStorage);
      if (!cleanupPatch || cleanupPatch.removedCount <= 0) {
        return cleanupPatch || { removedCount: 0, beforeCount: 0, afterCount: 0 };
      }

      await writeStoragePayload(cleanupPatch.payload);

      logBackgroundInfo(
        'Cleaned old learning data',
        `Reduced from ${cleanupPatch.beforeCount} to ${cleanupPatch.afterCount} entries`
      );
      return cleanupPatch;
    } catch (error) {
      logBackgroundError('Failed to clean storage', error);
      return { removedCount: 0, beforeCount: 0, afterCount: 0 };
    }
  }

  function shouldCheckStorageUsage(force = false) {
    if (force) {
      return true;
    }
    const now = Date.now();
    if (now - lastStorageCheckAt < STORAGE_CHECK_INTERVAL_MS) {
      return false;
    }
    lastStorageCheckAt = now;
    return true;
  }

  async function checkAndCleanStorageIfNeeded(options = {}) {
    const force = Boolean(options && options.force);
    if (!shouldCheckStorageUsage(force)) {
      return;
    }
    if (
      typeof chrome === 'undefined' ||
      !chrome.storage ||
      !chrome.storage.local ||
      typeof chrome.storage.local.getBytesInUse !== 'function'
    ) {
      return;
    }

    try {
      const bytesInUse = await new Promise((resolve, reject) => {
        chrome.storage.local.getBytesInUse(null, (bytes) => {
          const error = getChromeRuntimeError();
          if (error) {
            reject(error);
          } else {
            resolve(bytes);
          }
        });
      });

      const usagePercent = bytesInUse / MAX_STORAGE_SIZE_BYTES;
      if (usagePercent >= STORAGE_WARNING_THRESHOLD) {
        logBackgroundError(
          'Storage usage warning',
          new Error(`Usage: ${Math.round(usagePercent * 100)}% (${bytesInUse} bytes)`)
        );
        await tryCleanOldLearningData();
      }
    } catch (error) {
      logBackgroundError('Failed to check storage', error);
    }
  }

  async function setStoragePayload(payload) {
    await checkAndCleanStorageIfNeeded();

    try {
      await writeStoragePayload(payload);
    } catch (error) {
      if (!isStorageQuotaError(error)) {
        throw error;
      }

      const cleanupResult = await tryCleanOldLearningData();
      if (!cleanupResult || cleanupResult.removedCount <= 0) {
        throw error;
      }
      await writeStoragePayload(payload);
    }
  }

  const api = {
    SETTINGS_STORAGE_KEY_V3,
    WORD_STATS_V2_KEY,
    REVIEW_QUEUE_KEY,
    LEARNING_SUMMARY_KEY,
    getChromeRuntimeError,
    logBackgroundError,
    logBackgroundInfo,
    normalizeTimestamp,
    writeStoragePayload,
    getStoragePayload,
    setStoragePayload,
    checkAndCleanStorageIfNeeded,
    tryCleanOldLearningData,
    buildLearningDataCleanupPatch,
    isStorageQuotaError,
    sharedSettings,
    backgroundSettings,
  };

  globalScope.BackgroundStorage = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
