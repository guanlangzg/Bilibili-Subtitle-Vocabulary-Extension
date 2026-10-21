(function (globalScope) {
  // Legacy storage keys retained for backward compatibility with existing installs.
  const STORAGE_KEYS = {
    WORD_STATS_V2: 'bili_vocab_word_stats_v2',
    REVIEW_QUEUE: 'bili_vocab_review_queue_v1',
    LEARNING_SUMMARY: 'bili_vocab_learning_summary_v1',
    LEARNING_STREAK: 'bili_vocab_learning_streak_v1',
  };

  const STATUSES = ['unseen', 'seen', 'saved', 'mastered', 'skipped'];
  const REVIEW_BUCKETS = ['today', 'soon', 'later'];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_INTERVAL_DAYS = 1;
  const DEFAULT_EASE_FACTOR = 2.3;
  const MIN_EASE_FACTOR = 1.3;
  const MAX_EASE_FACTOR = 2.8;
  const MAX_INTERVAL_DAYS = 60;
  const STATUS_LABELS = {
    unseen: '未巩固',
    seen: '已遇见',
    saved: '已收藏',
    mastered: '已掌握',
    skipped: '已跳过',
  };
  const REVIEW_BUCKET_LABELS = {
    today: '今日优先',
    soon: '即将复习',
    later: '后续回顾',
  };
  const logError =
    globalThis.Utils && typeof globalThis.Utils.logError === 'function'
      ? globalThis.Utils.logError
      : (context, error) => console.error(`[BiliVocab] ${context}:`, error);

  function normalizeWord(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function normalizeStatus(value) {
    const normalized = String(value || 'unseen')
      .trim()
      .toLowerCase();
    if (STATUSES.includes(normalized)) {
      return normalized;
    }

    if (normalized === 'new') {
      return 'unseen';
    }
    if (normalized === 'learning' || normalized === 'reviewing') {
      return 'seen';
    }
    if (normalized === 'mastered') {
      return 'mastered';
    }
    return 'unseen';
  }

  function normalizeBucket(value) {
    const normalized = String(value || 'today')
      .trim()
      .toLowerCase();
    return REVIEW_BUCKETS.includes(normalized) ? normalized : 'today';
  }

  function normalizeIntervalDays(value, fallback = DEFAULT_INTERVAL_DAYS) {
    const interval = Number(value);
    if (!Number.isFinite(interval) || interval <= 0) {
      return Math.min(
        MAX_INTERVAL_DAYS,
        Math.max(DEFAULT_INTERVAL_DAYS, Math.floor(fallback || DEFAULT_INTERVAL_DAYS))
      );
    }
    return Math.min(MAX_INTERVAL_DAYS, Math.max(DEFAULT_INTERVAL_DAYS, Math.round(interval)));
  }

  function normalizeEaseFactor(value, fallback = DEFAULT_EASE_FACTOR) {
    const ease = Number(value);
    if (!Number.isFinite(ease)) {
      return Math.min(
        MAX_EASE_FACTOR,
        Math.max(MIN_EASE_FACTOR, Number(fallback) || DEFAULT_EASE_FACTOR)
      );
    }
    return Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, Number(ease.toFixed(2))));
  }

  function getIntervalByBucket(bucket) {
    const normalized = normalizeBucket(bucket);
    if (normalized === 'today') return 1;
    if (normalized === 'soon') return 3;
    return 7;
  }

  function getBucketFromSchedule(nextReviewAt, intervalDays, now = Date.now()) {
    const nextAt = normalizeTimestamp(nextReviewAt);
    if (nextAt != null) {
      const delta = nextAt - Number(now || Date.now());
      if (delta <= DAY_MS) {
        return 'today';
      }
      if (delta <= DAY_MS * 3) {
        return 'soon';
      }
      return 'later';
    }

    const interval = normalizeIntervalDays(intervalDays, DEFAULT_INTERVAL_DAYS);
    if (interval <= 1) {
      return 'today';
    }
    if (interval <= 3) {
      return 'soon';
    }
    return 'later';
  }

  function getStatusLabel(status) {
    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    if (STATUS_LABELS[normalized]) {
      return STATUS_LABELS[normalized];
    }
    if (normalized === 'new') {
      return STATUS_LABELS.unseen;
    }
    if (normalized === 'learning' || normalized === 'reviewing') {
      return STATUS_LABELS.seen;
    }
    return '待判断';
  }

  function getReviewBucketLabel(bucket) {
    const normalized = normalizeBucket(bucket);
    return REVIEW_BUCKET_LABELS[normalized] || REVIEW_BUCKET_LABELS.today;
  }

  // 学习 streak 相关功能
  let learningStreak = null;
  let learningStreakLoadPromise = null;
  let learningStreakMutationChain = Promise.resolve();

  // 生词本持久化状态（供 tooltip/options 同步使用）
  let wordStats = {};
  let reviewQueueState = {};
  let wordStatsReady = false;
  let wordStatsLoadPromise = null;
  let wordStatsMutationChain = Promise.resolve();

  function normalizeLearningStreak(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return {
      currentStreak: Math.max(0, Math.floor(Number(data.currentStreak) || 0)),
      maxStreak: Math.max(0, Math.floor(Number(data.maxStreak) || 0)),
      lastActiveDate: String(data.lastActiveDate || ''),
      totalActiveDays: Math.max(0, Math.floor(Number(data.totalActiveDays) || 0)),
      activeDays: Array.isArray(data.activeDays) ? data.activeDays : [],
    };
  }

  function getChromeRuntimeError() {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return null;
    }
    return chrome.runtime.lastError || null;
  }

  function createStorageError(action, runtimeError) {
    const message =
      runtimeError && runtimeError.message ? runtimeError.message : 'unknown chrome runtime error';
    return new Error(`${action}: ${message}`);
  }

  function readChromeLocalStorage(keys) {
    if (!hasChromeLocalStorage()) {
      return Promise.resolve({});
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (payload) => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(createStorageError('chrome.storage.local.get failed', runtimeError));
          return;
        }
        resolve(payload || {});
      });
    });
  }

  function writeChromeLocalStorage(payload) {
    if (!hasChromeLocalStorage()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(createStorageError('chrome.storage.local.set failed', runtimeError));
          return;
        }
        resolve();
      });
    });
  }

  function queueWordStatsMutation(task) {
    const run = wordStatsMutationChain.catch(() => {}).then(task);
    wordStatsMutationChain = run.catch(() => {});
    return run;
  }

  function hasRuntimeMessagingApi() {
    return Boolean(
      globalScope.RuntimeMessaging &&
      typeof globalScope.RuntimeMessaging.sendRuntimeMessage === 'function' &&
      globalScope.RuntimeMessaging.MESSAGE_TYPES
    );
  }

  function sendLearningMutation(type, payload) {
    if (!hasRuntimeMessagingApi()) {
      return Promise.reject(new Error('RuntimeMessaging unavailable'));
    }
    return globalScope.RuntimeMessaging.sendRuntimeMessage(type, payload);
  }

  function invalidateWordStatsCache() {
    // The background queue or another tab may have written the shared keys;
    // drop the page cache so the next read merges on top of their state.
    wordStatsReady = false;
    wordStatsLoadPromise = null;
  }

  function queueLearningStreakMutation(task) {
    const run = learningStreakMutationChain.catch(() => {}).then(task);
    learningStreakMutationChain = run.catch(() => {});
    return run;
  }

  async function loadLearningStreak() {
    if (learningStreak) {
      return learningStreak;
    }

    if (!hasChromeLocalStorage()) {
      learningStreak = normalizeLearningStreak({});
      return learningStreak;
    }

    if (!learningStreakLoadPromise) {
      learningStreakLoadPromise = readChromeLocalStorage([STORAGE_KEYS.LEARNING_STREAK])
        .then((payload) => {
          learningStreak = normalizeLearningStreak(payload[STORAGE_KEYS.LEARNING_STREAK]);
          return learningStreak;
        })
        .catch((error) => {
          learningStreak = normalizeLearningStreak({});
          logError('Learning streak read failed', error);
          return learningStreak;
        })
        .finally(() => {
          learningStreakLoadPromise = null;
        });
    }

    return learningStreakLoadPromise;
  }

  function getLocalDateString(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async function updateLearningStreak(now = Date.now()) {
    return queueLearningStreakMutation(async () => {
      const currentLearningStreak = learningStreak || (await loadLearningStreak());
      const referenceNow = normalizeTimestamp(now) || Date.now();
      const today = getLocalDateString(referenceNow);
      if (currentLearningStreak.lastActiveDate === today) {
        // 今日已经记录过
        return currentLearningStreak;
      }

      const yesterday = new Date(referenceNow);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getLocalDateString(yesterday.getTime());

      const nextLearningStreak = normalizeLearningStreak(currentLearningStreak);

      if (nextLearningStreak.lastActiveDate === yesterdayStr) {
        // 连续学习，streak +1
        nextLearningStreak.currentStreak += 1;
      } else if (nextLearningStreak.lastActiveDate !== today) {
        // 断签了，重置streak
        nextLearningStreak.currentStreak = 1;
      }

      // 更新最大 streak
      nextLearningStreak.maxStreak = Math.max(
        nextLearningStreak.maxStreak,
        nextLearningStreak.currentStreak
      );
      nextLearningStreak.lastActiveDate = today;

      // 记录活跃天数
      if (!nextLearningStreak.activeDays.includes(today)) {
        nextLearningStreak.activeDays = nextLearningStreak.activeDays.concat(today);
        nextLearningStreak.totalActiveDays = nextLearningStreak.activeDays.length;
      }

      if (hasChromeLocalStorage()) {
        try {
          await writeChromeLocalStorage({ [STORAGE_KEYS.LEARNING_STREAK]: nextLearningStreak });
        } catch (error) {
          logError('Learning streak write failed', error);
          return currentLearningStreak;
        }
      }

      learningStreak = nextLearningStreak;
      return learningStreak;
    });
  }

  function getLearningStreak() {
    return learningStreak || normalizeLearningStreak({});
  }

  function clampScore(value) {
    const score = Number(value);
    if (!Number.isFinite(score)) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  function normalizeCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
      return 0;
    }
    return Math.floor(count);
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    return Math.floor(timestamp);
  }

  function normalizeLevels(levels, fallbackLevel) {
    const source = Array.isArray(levels) ? levels : [fallbackLevel];
    const normalized = source
      .map((level) =>
        String(level || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean);
    return Array.from(new Set(normalized));
  }

  function normalizeLearningRecord(record, fallback = {}) {
    const source = record && typeof record === 'object' ? record : {};
    const word = normalizeWord(source.word || fallback.word);
    const exposureCount = normalizeCount(
      source.exposureCount != null ? source.exposureCount : source.hitCount
    );
    const seenCount = normalizeCount(source.seenCount != null ? source.seenCount : exposureCount);
    const firstSeenAt = normalizeTimestamp(
      source.firstSeenAt || source.firstSeen || source.lastSeenAt || source.lastSeen
    );
    const lastSeenAt = normalizeTimestamp(source.lastSeenAt || source.lastSeen);
    const lastReviewedAt = normalizeTimestamp(source.lastReviewedAt);
    const explicitBucket =
      source.nextReviewBucket != null ? normalizeBucket(source.nextReviewBucket) : null;
    const intervalDays = normalizeIntervalDays(
      source.intervalDays,
      getIntervalByBucket(explicitBucket || fallback.nextReviewBucket || 'today')
    );
    const easeFactor = normalizeEaseFactor(source.easeFactor);
    const scheduleAnchor = normalizeTimestamp(lastReviewedAt || lastSeenAt || firstSeenAt);
    const derivedNextReviewAt =
      scheduleAnchor != null ? normalizeTimestamp(scheduleAnchor + intervalDays * DAY_MS) : null;
    const nextReviewAt = normalizeTimestamp(source.nextReviewAt) || derivedNextReviewAt;
    const nextReviewBucket = explicitBucket || getBucketFromSchedule(nextReviewAt, intervalDays);

    return {
      word,
      translation: String(
        source.translation || source.meaning || fallback.translation || ''
      ).trim(),
      level: String(source.level || fallback.level || '')
        .trim()
        .toUpperCase(),
      sourceLevels: normalizeLevels(source.sourceLevels, source.level || fallback.level),
      exposureCount,
      hitCount: exposureCount,
      seenCount,
      lookupCount: normalizeCount(source.lookupCount),
      saveCount: normalizeCount(source.saveCount),
      reviewCount: normalizeCount(source.reviewCount),
      firstSeenAt,
      lastSeen: lastSeenAt,
      lastSeenAt,
      lastReviewedAt,
      masteryScore: clampScore(source.masteryScore),
      status: normalizeStatus(source.status || source.learningStatus),
      nextReviewBucket,
      intervalDays,
      easeFactor,
      nextReviewAt,
      savedAt: normalizeTimestamp(source.savedAt),
      details: normalizeVocabularyDetails(source.details || source),
      context: normalizeVocabularyContext(source),
      source: normalizeVocabularySource(source),
      exposures: normalizeCount(
        source.exposures != null
          ? source.exposures
          : source.exposureCount != null
            ? source.exposureCount
            : source.hitCount
      ),
    };
  }

  function migrateLegacyStat(stat) {
    const normalized = normalizeLearningRecord({
      word: stat && stat.word,
      translation: stat && (stat.translation || stat.meaning),
      level: stat && stat.level,
      sourceLevels: stat && stat.level ? [stat.level] : [],
      exposureCount: stat && stat.hitCount,
      seenCount: stat && stat.hitCount,
      firstSeenAt: stat && stat.lastSeen,
      lastSeenAt: stat && stat.lastSeen,
      masteryScore: 10,
      status: 'unseen',
      nextReviewBucket: 'today',
    });

    if (normalized.exposureCount >= 3) {
      normalized.status = 'seen';
      normalized.masteryScore = Math.max(normalized.masteryScore, 30);
    }
    if (normalized.exposureCount >= 7) {
      normalized.status = 'seen';
      normalized.masteryScore = Math.max(normalized.masteryScore, 60);
    }

    return normalized;
  }

  function deriveStatus(record) {
    if (record.masteryScore >= 80 && record.reviewCount >= 3 && record.seenCount >= 2) {
      return 'mastered';
    }

    if (record.saveCount > 0) {
      return 'saved';
    }

    if (record.status === 'skipped' && record.reviewCount === 0 && record.saveCount === 0) {
      return 'skipped';
    }

    if (
      record.exposureCount >= 2 ||
      record.seenCount >= 2 ||
      record.reviewCount >= 1 ||
      record.masteryScore >= 20
    ) {
      return 'seen';
    }

    return 'unseen';
  }

  function recordExposure(record, payload, now = Date.now()) {
    const base = record
      ? normalizeLearningRecord(record, payload)
      : normalizeLearningRecord({
          ...payload,
          word: payload && payload.word,
          translation: payload && payload.translation,
          level: payload && payload.level,
          sourceLevels: payload && payload.sourceLevels,
          status: 'unseen',
          nextReviewBucket: 'today',
        });

    const firstSeenAt = base.firstSeenAt || normalizeTimestamp(now);
    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    const next = {
      ...base,
      translation: String((payload && payload.translation) || base.translation || '').trim(),
      level: String((payload && payload.level) || base.level || '')
        .trim()
        .toUpperCase(),
      sourceLevels: normalizeLevels([
        ...(base.sourceLevels || []),
        ...normalizeLevels(payload && payload.sourceLevels, payload && payload.level),
      ]),
      exposureCount: base.exposureCount + 1,
      hitCount: base.exposureCount + 1,
      seenCount: base.seenCount + 1,
      firstSeenAt,
      lastSeen: nowTimestamp,
      lastSeenAt: nowTimestamp,
      masteryScore: clampScore(base.masteryScore + (base.status === 'mastered' ? 0 : 5)),
      intervalDays: normalizeIntervalDays(base.intervalDays, DEFAULT_INTERVAL_DAYS),
      easeFactor: normalizeEaseFactor(base.easeFactor, DEFAULT_EASE_FACTOR),
    };

    if (base.status === 'mastered') {
      next.status = 'mastered';
      next.intervalDays = normalizeIntervalDays(Math.max(next.intervalDays, 7), 7);
      next.nextReviewAt = normalizeTimestamp(nowTimestamp + next.intervalDays * DAY_MS);
      next.nextReviewBucket = getBucketFromSchedule(
        next.nextReviewAt,
        next.intervalDays,
        nowTimestamp
      );
      return next;
    }

    next.status = deriveStatus(next);
    if (next.status === 'skipped') {
      next.intervalDays = normalizeIntervalDays(Math.max(next.intervalDays, 7), 7);
      next.nextReviewAt = normalizeTimestamp(nowTimestamp + next.intervalDays * DAY_MS);
      next.nextReviewBucket = 'later';
    } else {
      next.intervalDays = DEFAULT_INTERVAL_DAYS;
      next.nextReviewAt = normalizeTimestamp(nowTimestamp + 2 * 60 * 60 * 1000);
      next.nextReviewBucket = getBucketFromSchedule(
        next.nextReviewAt,
        next.intervalDays,
        nowTimestamp
      );
    }

    return next;
  }

  function applyLearningAction(record, action, now = Date.now()) {
    const normalized = normalizeLearningRecord(record);
    const decision = String(action || '')
      .trim()
      .toLowerCase();
    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    const baseInterval = normalizeIntervalDays(
      normalized.intervalDays,
      getIntervalByBucket(normalized.nextReviewBucket)
    );
    const baseEase = normalizeEaseFactor(normalized.easeFactor, DEFAULT_EASE_FACTOR);

    if (decision === 'save') {
      const intervalDays = normalizeIntervalDays(Math.max(2, Math.round(baseInterval * 1.2)), 2);
      const easeFactor = normalizeEaseFactor(baseEase + 0.05);
      const nextReviewAt = normalizeTimestamp(nowTimestamp + intervalDays * DAY_MS);
      const nextSaved = {
        ...normalized,
        saveCount: normalized.saveCount + 1,
        masteryScore: clampScore(normalized.masteryScore + 8),
        lastReviewedAt: nowTimestamp,
        status: 'saved',
        intervalDays,
        easeFactor,
        nextReviewAt,
        nextReviewBucket: getBucketFromSchedule(nextReviewAt, intervalDays, nowTimestamp),
      };
      return nextSaved;
    }

    if (decision === 'skip') {
      const intervalDays = normalizeIntervalDays(Math.max(7, baseInterval), 7);
      const easeFactor = normalizeEaseFactor(baseEase - 0.1);
      const nextReviewAt = normalizeTimestamp(nowTimestamp + intervalDays * DAY_MS);
      const nextSkipped = {
        ...normalized,
        masteryScore: clampScore(normalized.masteryScore - 10),
        lastReviewedAt: nowTimestamp,
        status: 'skipped',
        intervalDays,
        easeFactor,
        nextReviewAt,
        nextReviewBucket: 'later',
      };
      return nextSkipped;
    }

    const scoreDelta = decision === 'know' ? 30 : decision === 'fuzzy' ? 10 : -20;
    let intervalDays = baseInterval;
    let easeFactor = baseEase;
    if (decision === 'know') {
      intervalDays = normalizeIntervalDays(Math.round(baseInterval * baseEase), baseInterval);
      easeFactor = normalizeEaseFactor(baseEase + 0.1);
    } else if (decision === 'fuzzy') {
      intervalDays = normalizeIntervalDays(Math.round(baseInterval * 0.75), baseInterval);
      easeFactor = normalizeEaseFactor(baseEase - 0.05);
    } else {
      intervalDays = DEFAULT_INTERVAL_DAYS;
      easeFactor = normalizeEaseFactor(baseEase - 0.2);
    }

    const nextReviewAt = normalizeTimestamp(nowTimestamp + intervalDays * DAY_MS);
    const next = {
      ...normalized,
      reviewCount: normalized.reviewCount + 1,
      lastReviewedAt: nowTimestamp,
      masteryScore: clampScore(normalized.masteryScore + scoreDelta),
      intervalDays,
      easeFactor,
      nextReviewAt,
    };

    next.status = deriveStatus(next);
    if (next.status === 'mastered') {
      next.nextReviewBucket = 'later';
    } else if (decision === 'dontknow') {
      next.nextReviewBucket = 'today';
    } else {
      next.nextReviewBucket = getBucketFromSchedule(
        next.nextReviewAt,
        next.intervalDays,
        nowTimestamp
      );
    }

    return next;
  }

  function applyReviewFeedback(record, feedback, now = Date.now()) {
    return applyLearningAction(record, feedback, now);
  }

  function normalizeReviewQueue(queue) {
    if (!queue || typeof queue !== 'object') {
      return {};
    }

    const normalized = {};
    Object.keys(queue).forEach((key) => {
      const word = normalizeWord(key);
      if (!word) {
        return;
      }
      const item = queue[key];
      const intervalDays = normalizeIntervalDays(
        item && item.intervalDays,
        getIntervalByBucket(item && item.dueBucket)
      );
      const nextReviewAt = normalizeTimestamp(item && item.nextReviewAt);
      normalized[word] = {
        word,
        dueBucket:
          item && item.dueBucket
            ? normalizeBucket(item.dueBucket)
            : getBucketFromSchedule(nextReviewAt, intervalDays),
        nextReviewAt,
        intervalDays,
        easeFactor: normalizeEaseFactor(item && item.easeFactor),
        updatedAt: normalizeTimestamp(item && item.updatedAt),
        lastSeenAt: normalizeTimestamp(item && item.lastSeenAt),
        sourceLevels: normalizeLevels(item && item.sourceLevels, item && item.level),
      };
    });
    return normalized;
  }

  function syncReviewQueue(queue, record, now = Date.now()) {
    const nextQueue = { ...normalizeReviewQueue(queue) };
    const normalized = normalizeLearningRecord(record);
    const word = normalizeWord(normalized.word);
    if (!word) {
      return nextQueue;
    }

    if (normalized.status === 'mastered' || normalized.status === 'skipped') {
      delete nextQueue[word];
      return nextQueue;
    }

    nextQueue[word] = {
      word,
      dueBucket: getBucketFromSchedule(normalized.nextReviewAt, normalized.intervalDays, now),
      nextReviewAt: normalizeTimestamp(normalized.nextReviewAt),
      intervalDays: normalizeIntervalDays(
        normalized.intervalDays,
        getIntervalByBucket(normalized.nextReviewBucket)
      ),
      easeFactor: normalizeEaseFactor(normalized.easeFactor),
      updatedAt: normalizeTimestamp(now),
      lastSeenAt: normalized.lastSeenAt,
      sourceLevels: normalized.sourceLevels,
    };
    return nextQueue;
  }

  function buildLearningSummary(records, queue) {
    const recordMap = records && typeof records === 'object' ? records : {};
    const queueMap = normalizeReviewQueue(queue);
    const items = Object.values(recordMap)
      .map((item) => normalizeLearningRecord(item))
      .filter((item) => item.word);

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

    items.forEach((item) => {
      if (item.status === 'unseen') summary.unseenCount += 1;
      if (item.status === 'seen') summary.seenCount += 1;
      if (item.status === 'saved') summary.savedCount += 1;
      if (item.status === 'mastered') summary.masteredCount += 1;
      if (item.status === 'skipped') summary.skippedCount += 1;
    });

    summary.newCount = summary.unseenCount;
    summary.learningCount = summary.seenCount;
    summary.reviewingCount = summary.savedCount;

    Object.values(queueMap).forEach((item) => {
      if (item.dueBucket === 'today') summary.todayCount += 1;
      if (item.dueBucket === 'soon') summary.soonCount += 1;
    });

    summary.recentWords = items
      .slice()
      .sort((left, right) => (right.lastSeenAt || 0) - (left.lastSeenAt || 0))
      .slice(0, 5)
      .map((item) => ({
        word: item.word,
        status: item.status,
        lastSeenAt: item.lastSeenAt,
        nextReviewBucket: item.nextReviewBucket,
        nextReviewAt: item.nextReviewAt,
        intervalDays: item.intervalDays,
        easeFactor: item.easeFactor,
      }));

    return summary;
  }

  function hasChromeLocalStorage() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' &&
      typeof chrome.storage.local.set === 'function'
    );
  }

  function normalizeVocabularyDetails(details) {
    const source = details && typeof details === 'object' ? details : {};
    return {
      meaning: String(source.meaning || source.translation || '').trim(),
      level: String(source.level || '')
        .trim()
        .toUpperCase(),
      phonetic: String(source.phonetic || '').trim(),
    };
  }

  function normalizeVocabularyContext(details) {
    const source = details && typeof details === 'object' ? details : {};
    return String(
      source.context ||
        source.example ||
        source.originalSubtitle ||
        (source.details &&
        typeof source.details === 'object' &&
        (source.details.context || source.details.example || source.details.originalSubtitle)
          ? source.details.context || source.details.example || source.details.originalSubtitle
          : '')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeSourceTimeSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.floor(seconds);
  }

  function formatSourceTimeLabel(value) {
    const totalSeconds = normalizeSourceTimeSeconds(value);
    if (totalSeconds == null) {
      return '';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
        .join(':');
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function normalizeVocabularySource(details) {
    const source = details && typeof details === 'object' ? details : {};
    const detailsSource =
      source.details && typeof source.details === 'object' ? source.details : {};
    const nestedSource =
      source.source && typeof source.source === 'object'
        ? source.source
        : detailsSource.source && typeof detailsSource.source === 'object'
          ? detailsSource.source
          : {};
    const title = String(nestedSource.title || source.sourceTitle || '')
      .replace(/\s+/g, ' ')
      .trim();
    const url = String(nestedSource.url || source.sourceUrl || '')
      .replace(/\s+/g, ' ')
      .trim();
    const timeSeconds = normalizeSourceTimeSeconds(
      nestedSource.timeSeconds != null
        ? nestedSource.timeSeconds
        : source.sourceTimeSeconds != null
          ? source.sourceTimeSeconds
          : source.sourceTime
    );
    const timeLabel =
      String(nestedSource.timeLabel || source.sourceTimeLabel || '')
        .replace(/\s+/g, ' ')
        .trim() || formatSourceTimeLabel(timeSeconds);

    if (!title && !url && timeSeconds == null && !timeLabel) {
      return null;
    }

    const normalized = {};
    if (title) {
      normalized.title = title;
    }
    if (url) {
      normalized.url = url;
    }
    if (timeSeconds != null) {
      normalized.timeSeconds = timeSeconds;
    }
    if (timeLabel) {
      normalized.timeLabel = timeLabel;
    }
    return normalized;
  }

  function mergeVocabularySource(primary, fallback) {
    const nextSource = normalizeVocabularySource(primary);
    const previousSource = normalizeVocabularySource(fallback);
    if (!nextSource && !previousSource) {
      return null;
    }

    const timeSeconds =
      nextSource && nextSource.timeSeconds != null
        ? nextSource.timeSeconds
        : previousSource && previousSource.timeSeconds != null
          ? previousSource.timeSeconds
          : null;
    const timeLabel =
      (nextSource && nextSource.timeLabel) ||
      (previousSource && previousSource.timeLabel) ||
      formatSourceTimeLabel(timeSeconds);

    const merged = {};
    const title =
      (nextSource && nextSource.title) || (previousSource && previousSource.title) || '';
    const url = (nextSource && nextSource.url) || (previousSource && previousSource.url) || '';
    if (title) {
      merged.title = title;
    }
    if (url) {
      merged.url = url;
    }
    if (timeSeconds != null) {
      merged.timeSeconds = timeSeconds;
    }
    if (timeLabel) {
      merged.timeLabel = timeLabel;
    }
    return merged;
  }

  function normalizeWordStatsMap(rawStats) {
    if (!rawStats || typeof rawStats !== 'object') {
      return {};
    }

    const normalized = {};
    Object.keys(rawStats).forEach((key) => {
      const item = rawStats[key];
      if (!item || typeof item !== 'object') {
        return;
      }

      const word = normalizeWord(item.word || key);
      if (!word) {
        return;
      }

      const normalizedItem = normalizeLearningRecord(item, {
        word,
        translation: item.translation || (item.details && item.details.meaning),
        level: item.level || (item.details && item.details.level),
      });

      normalizedItem.word = word;
      normalizedItem.savedAt = normalizeTimestamp(item.savedAt);
      normalizedItem.details = normalizeVocabularyDetails(item.details || item);
      normalizedItem.context = normalizeVocabularyContext(item);
      normalizedItem.source = normalizeVocabularySource(item);
      normalizedItem.exposures = normalizeCount(
        item.exposures != null ? item.exposures : normalizedItem.exposureCount
      );
      normalized[word] = normalizedItem;
    });

    return normalized;
  }

  function toVocabularyExportRecord(record) {
    const normalized = normalizeLearningRecord(record);
    const details = normalizeVocabularyDetails(record && record.details);
    const exposures = normalizeCount(
      record && record.exposures != null
        ? record.exposures
        : normalized.exposureCount != null
          ? normalized.exposureCount
          : normalized.hitCount
    );
    return {
      ...normalized,
      word: normalized.word,
      status: normalized.status,
      savedAt: normalizeTimestamp(record && record.savedAt),
      details,
      context: normalizeVocabularyContext(record),
      source: normalizeVocabularySource(record),
      exposures,
    };
  }

  function setWordStatsState(nextWordStats, nextReviewQueue) {
    wordStats = nextWordStats && typeof nextWordStats === 'object' ? nextWordStats : {};
    reviewQueueState =
      nextReviewQueue && typeof nextReviewQueue === 'object' ? nextReviewQueue : {};
    wordStatsReady = true;
  }

  function ensureWordStatsLoaded() {
    if (wordStatsReady) {
      return Promise.resolve(wordStats);
    }

    if (wordStatsLoadPromise) {
      return wordStatsLoadPromise;
    }

    if (!hasChromeLocalStorage()) {
      setWordStatsState({}, {});
      return Promise.resolve(wordStats);
    }

    wordStatsLoadPromise = readChromeLocalStorage([
      STORAGE_KEYS.WORD_STATS_V2,
      STORAGE_KEYS.REVIEW_QUEUE,
    ])
      .then((payload) => {
        setWordStatsState(
          normalizeWordStatsMap(payload[STORAGE_KEYS.WORD_STATS_V2]),
          normalizeReviewQueue(payload[STORAGE_KEYS.REVIEW_QUEUE])
        );
        return wordStats;
      })
      .finally(() => {
        wordStatsLoadPromise = null;
      });

    return wordStatsLoadPromise;
  }

  function reloadWordStats() {
    // Force a fresh read so mutations never build on a stale cross-context snapshot
    // (background recordLearningHit/applyReviewFeedback write the same keys).
    wordStatsReady = false;
    wordStatsLoadPromise = null;
    return ensureWordStatsLoaded();
  }

  function watchLearningStorageChanges() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.storage ||
      !chrome.storage.onChanged ||
      typeof chrome.storage.onChanged.addListener !== 'function'
    ) {
      return;
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }

      const learningKeys = [
        STORAGE_KEYS.WORD_STATS_V2,
        STORAGE_KEYS.REVIEW_QUEUE,
        STORAGE_KEYS.LEARNING_SUMMARY,
        STORAGE_KEYS.LEARNING_STREAK,
      ];
      if (!learningKeys.some((key) => Boolean(changes && changes[key]))) {
        return;
      }

      // Drop cached state so the next read picks up writes made by the
      // background queue or another tab instead of overwriting them later.
      wordStatsReady = false;
      wordStatsLoadPromise = null;
      if (changes[STORAGE_KEYS.LEARNING_STREAK]) {
        learningStreak = null;
        learningStreakLoadPromise = null;
      }
    });
  }

  watchLearningStorageChanges();

  // Pure record builders shared by the page fallback and the background
  // single-writer so both contexts merge identical record shapes.
  function buildSavedWordRecord(word, existing, details = {}, now = Date.now()) {
    const wordKey = normalizeWord(word);
    const baseRecord = existing || normalizeLearningRecord({ word: wordKey });
    const mergedDetails = {
      ...normalizeVocabularyDetails(baseRecord.details),
      ...normalizeVocabularyDetails(details),
    };
    const mergedContext =
      normalizeVocabularyContext(details) || normalizeVocabularyContext(baseRecord);
    const mergedSource = mergeVocabularySource(details, baseRecord);

    return {
      ...normalizeLearningRecord(baseRecord, {
        word: wordKey,
        translation: mergedDetails.meaning,
        level: mergedDetails.level,
      }),
      word: wordKey,
      status: 'saved',
      saveCount: normalizeCount((baseRecord.saveCount || 0) + 1),
      lastReviewedAt: normalizeTimestamp(now),
      savedAt: normalizeTimestamp(now),
      details: mergedDetails,
      context: mergedContext,
      source: mergedSource,
      exposures: normalizeCount(
        baseRecord.exposures != null ? baseRecord.exposures : baseRecord.exposureCount
      ),
    };
  }

  function buildRemovedWordRecord(word, existing, now = Date.now()) {
    const wordKey = normalizeWord(word);
    if (!existing || existing.status !== 'saved') {
      return null;
    }

    const nextRecord = {
      ...normalizeLearningRecord(existing),
      word: wordKey,
      status: 'seen',
      saveCount: normalizeCount(Math.max(0, (existing.saveCount || 1) - 1)),
      details: normalizeVocabularyDetails(existing.details),
      exposures: normalizeCount(
        existing.exposures != null ? existing.exposures : existing.exposureCount
      ),
    };
    delete nextRecord.savedAt;
    return nextRecord;
  }

  function buildPersistableWordStats(sourceWordStats = wordStats) {
    const payload = {};
    Object.keys(sourceWordStats || {}).forEach((key) => {
      const item = sourceWordStats[key];
      if (!item || typeof item !== 'object') {
        return;
      }

      const record = toVocabularyExportRecord(item);
      if (!record.word) {
        return;
      }

      payload[key] = {
        ...record,
        translation: record.translation || record.details.meaning,
        level: record.level || record.details.level,
        hitCount: record.exposureCount,
        exposureCount: record.exposureCount,
        seenCount: record.seenCount,
        details: record.details,
        context: record.context,
        source: record.source || undefined,
        exposures: record.exposures,
      };
    });
    return payload;
  }

  async function persistWordStatsSnapshot(nextWordStats, nextReviewQueue) {
    const persistableStats = buildPersistableWordStats(nextWordStats);
    const summary = buildLearningSummary(persistableStats, nextReviewQueue);
    await writeChromeLocalStorage({
      [STORAGE_KEYS.WORD_STATS_V2]: persistableStats,
      [STORAGE_KEYS.REVIEW_QUEUE]: nextReviewQueue,
      [STORAGE_KEYS.LEARNING_SUMMARY]: summary,
    });
    return summary;
  }

  // 生词本功能
  function saveWordToVocabularyBook(word, details = {}) {
    return queueWordStatsMutation(async () => {
      const wordKey = normalizeWord(word);
      if (!wordKey) {
        return false;
      }

      const now = Date.now();

      // Single-writer path: the background queue merges this save onto the
      // latest stored snapshot so concurrent hits/reviews from other contexts
      // are never rolled back by a page-side full-map write.
      if (hasRuntimeMessagingApi()) {
        try {
          const result = await sendLearningMutation(
            globalScope.RuntimeMessaging.MESSAGE_TYPES.LEARNING_SAVE_WORD,
            { word: wordKey, details, now }
          );
          invalidateWordStatsCache();
          void updateLearningStreak(now);
          return Boolean(result && result.saved);
        } catch (error) {
          logError('Vocabulary book background save failed', error);
          // Fall through to the local read-modify-write fallback.
        }
      }

      try {
        await reloadWordStats();
      } catch (error) {
        logError('Vocabulary book state read failed', error);
        return false;
      }

      const existing = wordStats[wordKey];
      const nextRecord = buildSavedWordRecord(wordKey, existing, details, now);
      const nextWordStats = {
        ...wordStats,
        [wordKey]: nextRecord,
      };
      const nextReviewQueue = syncReviewQueue(reviewQueueState, nextRecord, now);

      try {
        await persistWordStatsSnapshot(nextWordStats, nextReviewQueue);
      } catch (error) {
        logError('Vocabulary book save failed', error);
        return false;
      }

      setWordStatsState(nextWordStats, nextReviewQueue);
      void updateLearningStreak(now);
      return true;
    });
  }

  function removeWordFromVocabularyBook(word) {
    return queueWordStatsMutation(async () => {
      const wordKey = normalizeWord(word);
      if (!wordKey) {
        return false;
      }

      if (hasRuntimeMessagingApi()) {
        try {
          const result = await sendLearningMutation(
            globalScope.RuntimeMessaging.MESSAGE_TYPES.LEARNING_REMOVE_WORD,
            { word: wordKey, now: Date.now() }
          );
          invalidateWordStatsCache();
          return Boolean(result && result.removed);
        } catch (error) {
          logError('Vocabulary book background remove failed', error);
          // Fall through to the local read-modify-write fallback.
        }
      }

      try {
        await reloadWordStats();
      } catch (error) {
        logError('Vocabulary book state read failed', error);
        return false;
      }

      const existing = wordStats[wordKey];
      if (!existing || existing.status !== 'saved') {
        return false;
      }

      const nextRecord = buildRemovedWordRecord(wordKey, existing, Date.now());
      const nextWordStats = {
        ...wordStats,
        [wordKey]: nextRecord,
      };
      const nextReviewQueue = syncReviewQueue(reviewQueueState, nextRecord, Date.now());

      try {
        await persistWordStatsSnapshot(nextWordStats, nextReviewQueue);
      } catch (error) {
        logError('Vocabulary book remove failed', error);
        return false;
      }

      setWordStatsState(nextWordStats, nextReviewQueue);
      return true;
    });
  }

  function getVocabularyBookWords(filter = 'all') {
    if (!wordStatsReady) {
      ensureWordStatsLoaded().catch((error) => {
        logError('Vocabulary book state read failed', error);
      });
    }

    const allSaved = Object.values(wordStats || {})
      .map((item) => toVocabularyExportRecord(item))
      .filter((item) => item.status === 'saved')
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    if (filter === 'today') {
      const today = new Date().setHours(0, 0, 0, 0);
      return allSaved.filter((w) => (w.savedAt || 0) >= today);
    }
    if (filter === 'week') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return allSaved.filter((w) => (w.savedAt || 0) >= weekAgo);
    }
    return allSaved;
  }

  const api = {
    STORAGE_KEYS,
    STATUSES,
    REVIEW_BUCKETS,
    STATUS_LABELS,
    REVIEW_BUCKET_LABELS,
    normalizeLearningRecord,
    normalizeReviewQueue,
    migrateLegacyStat,
    recordExposure,
    applyLearningAction,
    applyReviewFeedback,
    syncReviewQueue,
    buildLearningSummary,
    buildSavedWordRecord,
    buildRemovedWordRecord,
    getStatusLabel,
    getReviewBucketLabel,
    saveWordToVocabularyBook,
    removeWordFromVocabularyBook,
    getVocabularyBookWords,
    loadLearningStreak,
    updateLearningStreak,
    getLearningStreak,
  };

  globalScope.LearningState = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
