(function (globalScope) {
  // Dependencies are loaded by background.js importScripts before this module.
  // In Node tests, require() provides the same modules.
  const learningData =
    globalScope.LearningData ||
    (typeof require === 'function' ? require('./learningData.js') : null);
  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);

  const STORAGE_KEY = learningData ? learningData.STORAGE_KEY : 'bili_vocab_learning_data_v1';

  function ensureDependencies() {
    if (!learningData || !learningState) {
      throw new Error('LearningData modules unavailable');
    }
  }

  function generateDeviceId() {
    const cryptoApi = globalScope.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error('Secure device identifier unavailable');
  }

  function createEmptyBundle(now) {
    return {
      format: learningData.FORMAT,
      schemaVersion: learningData.SCHEMA_VERSION,
      exportedAt: now,
      events: [],
      baselines: [],
    };
  }

  function normalizeState(rawState) {
    if (rawState == null) {
      return null;
    }
    if (
      typeof rawState !== 'object' ||
      typeof rawState.deviceId !== 'string' ||
      !rawState.deviceId.trim() ||
      rawState.legacyMigrated !== true ||
      !rawState.bundle ||
      rawState.bundle.format !== learningData.FORMAT ||
      rawState.bundle.schemaVersion !== learningData.SCHEMA_VERSION ||
      !Array.isArray(rawState.bundle.events) ||
      !Array.isArray(rawState.bundle.baselines)
    ) {
      throw new Error('Invalid learning data state');
    }
    return {
      deviceId: rawState.deviceId,
      legacyMigrated: true,
      bundle: {
        format: learningData.FORMAT,
        schemaVersion: learningData.SCHEMA_VERSION,
        exportedAt: typeof rawState.bundle.exportedAt === 'number' ? rawState.bundle.exportedAt : 0,
        events: rawState.bundle.events.slice(),
        baselines: rawState.bundle.baselines.slice(),
      },
    };
  }

  // The protocol requires a baseline's schedule snapshot to carry the same
  // lastReviewedAt as the baseline itself; drop an inconsistent inherited
  // snapshot so legacySchedule rebuilds one from the record's real times.
  function toBaselineRecord(record) {
    const lastReviewedAt =
      record.lastReviewedAt != null
        ? record.lastReviewedAt
        : record.schedule && record.schedule.lastReviewedAt != null
          ? record.schedule.lastReviewedAt
          : null;
    const schedule =
      record.schedule &&
      typeof record.schedule === 'object' &&
      (record.schedule.lastReviewedAt == null
        ? lastReviewedAt == null
        : record.schedule.lastReviewedAt === lastReviewedAt)
        ? record.schedule
        : null;
    return { ...record, lastReviewedAt, schedule };
  }

  function createState(stats, now, deviceId = generateDeviceId()) {
    ensureDependencies();
    const baselines = [];
    Object.keys(stats || {}).forEach((key) => {
      const record = stats[key];
      if (!record || typeof record !== 'object') {
        return;
      }
      try {
        baselines.push(learningData.createBaseline(toBaselineRecord(record), deviceId, now));
      } catch (error) {
        throw new Error(`Invalid legacy baseline for ${key}: ${error.message}`);
      }
    });
    baselines.sort((left, right) =>
      left.baselineId < right.baselineId ? -1 : left.baselineId > right.baselineId ? 1 : 0
    );
    return {
      deviceId,
      legacyMigrated: true,
      bundle: {
        ...createEmptyBundle(now),
        baselines,
      },
    };
  }

  function ensureState(rawState, stats, now) {
    const normalized = normalizeState(rawState);
    if (normalized) {
      return normalized;
    }
    return createState(stats, now);
  }

  function findEvent(state, eventId) {
    if (!state || !eventId) {
      return null;
    }
    return state.bundle.events.find((event) => event.eventId === eventId) || null;
  }

  function createExtensionEvent(state, input) {
    ensureDependencies();
    return learningData.createEvent({
      ...input,
      deviceId: state.deviceId,
      source: 'extension',
    });
  }

  function appendEvents(state, events, exportedAt) {
    ensureDependencies();
    if (!events || events.length === 0) {
      return state;
    }
    const existing = new Map(state.bundle.events.map((event) => [event.eventId, event]));
    const nextEvents = state.bundle.events.slice();
    events.forEach((rawEvent) => {
      const event = learningData.normalizeEvent(rawEvent);
      const previous = existing.get(event.eventId);
      if (previous) {
        if (learningData.canonical(previous) !== learningData.canonical(event)) {
          throw new Error(`Conflicting eventId: ${event.eventId}`);
        }
        return;
      }
      existing.set(event.eventId, event);
      nextEvents.push(event);
    });
    return {
      ...state,
      bundle: {
        ...state.bundle,
        exportedAt,
        events: nextEvents,
      },
    };
  }

  function mergeIncoming(state, incoming, now) {
    ensureDependencies();
    return {
      ...state,
      bundle: learningData.mergeBundles(state.bundle, incoming, now),
    };
  }

  function exportBundle(state, now) {
    ensureDependencies();
    return learningData.normalizeBundle({
      ...state.bundle,
      exportedAt: now,
    });
  }

  function hasFormalSchedule(record) {
    return Boolean(
      record &&
      record.schedule &&
      record.schedule.algorithm &&
      record.schedule.algorithm !== learningData.LEGACY_ALGORITHM
    );
  }

  function collectSaveTimes(bundle) {
    const saveTimes = new Map();
    bundle.events.forEach((event) => {
      if (event.type !== 'save') {
        return;
      }
      saveTimes.set(event.wordId, Math.max(saveTimes.get(event.wordId) || 0, event.occurredAt));
    });
    return saveTimes;
  }

  function resolveProjectedStatus(progress, existing, schedule) {
    if (progress.saved) {
      return 'saved';
    }
    if (progress.suspended) {
      return 'skipped';
    }
    // A shared schedule is the authority: a formal scheduler may have moved the
    // word back to learning/relearning, so the cached display status must not
    // keep it at mastered.
    if (schedule) {
      if (schedule.state === 'mastered') {
        return 'mastered';
      }
      return progress.exposureCount >= 2 || progress.reviewCount >= 1 ? 'seen' : 'unseen';
    }
    if (existing && existing.status === 'mastered') {
      return 'mastered';
    }
    if (progress.exposureCount >= 2 || progress.reviewCount >= 1) {
      return 'seen';
    }
    if (existing && existing.status === 'seen') {
      return 'seen';
    }
    return 'unseen';
  }

  function buildQueue(stats, now, baseQueue, touchedWords) {
    const queue = learningState.normalizeReviewQueue(baseQueue);
    const touched = touchedWords || new Set(Object.keys(stats || {}));
    Object.keys(stats || {}).forEach((word) => {
      if (!touched.has(word)) {
        return;
      }
      const normalized = learningState.normalizeLearningRecord(stats[word]);
      if (!normalized.word) {
        return;
      }
      // Untouched words keep their existing queue entry (legacy clear leaves
      // the queue alone); touched ones are resynced from the shared record.
      if (
        normalized.status === 'mastered' ||
        normalized.status === 'skipped' ||
        normalized.suspended
      ) {
        delete queue[normalized.word];
        return;
      }
      if (
        normalized.exposureCount <= 0 &&
        normalized.reviewCount <= 0 &&
        normalized.saveCount <= 0
      ) {
        delete queue[normalized.word];
        return;
      }
      queue[normalized.word] = {
        word: normalized.word,
        dueBucket: learningState.getBucketFromSchedule(
          normalized.nextReviewAt,
          normalized.intervalDays,
          now
        ),
        nextReviewAt: normalized.nextReviewAt,
        intervalDays: normalized.intervalDays,
        easeFactor: normalized.easeFactor,
        updatedAt: now,
        lastSeenAt: normalized.lastSeenAt,
        sourceLevels: normalized.sourceLevels,
      };
    });
    return learningState.normalizeReviewQueue(queue);
  }

  function buildProjection(state, existingStats, now, existingQueue, touchedWords) {
    ensureDependencies();
    const bundle = exportBundle(state, now);
    const progress = learningData.deriveProgress(bundle);
    const saveTimes = collectSaveTimes(bundle);
    // Words without a post-migration event keep their legacy display status:
    // the baseline only captures aggregates and must not downgrade it.
    const activity = new Set(bundle.events.map((event) => event.wordId));
    const touched = touchedWords || new Set(Object.keys(progress).map((id) => progress[id].word));
    const stats = { ...(existingStats || {}) };

    Object.keys(progress).forEach((wordId) => {
      const item = progress[wordId];
      const existing = existingStats && existingStats[item.word] ? existingStats[item.word] : null;
      const schedule = item.schedule || (existing && existing.schedule) || null;
      const saved = item.saved === true;
      const suspended = item.suspended === true;
      const status =
        !activity.has(wordId) && existing && existing.status
          ? existing.status
          : resolveProjectedStatus(item, existing, schedule);
      const record = learningState.normalizeLearningRecord({
        ...(existing || {}),
        word: item.word,
        translation: (existing && existing.translation) || '',
        level: (existing && existing.level) || item.bookCodes[0] || '',
        sourceLevels: item.bookCodes.length ? item.bookCodes : existing && existing.sourceLevels,
        bookCodes: item.bookCodes,
        exposureCount: item.exposureCount,
        hitCount: item.exposureCount,
        seenCount: item.exposureCount,
        lookupCount: item.lookupCount,
        reviewCount: item.reviewCount,
        // Unsaving keeps the legacy decrement for a single remove and the reset
        // for clear, both of which arrive through the override record.
        saveCount: saved
          ? item.saveCount
          : existing && existing.saveCount != null
            ? existing.saveCount
            : 0,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        lastSeen: item.lastSeenAt,
        lastReviewedAt: item.lastReviewedAt,
        status,
        saved,
        suspended,
        savedAt: saved ? saveTimes.get(wordId) || (existing && existing.savedAt) || null : null,
        nextReviewAt: schedule ? schedule.dueAt : existing && existing.nextReviewAt,
        intervalDays: schedule ? schedule.scheduledDays : existing && existing.intervalDays,
        easeFactor:
          schedule && schedule.legacyEaseFactor != null
            ? schedule.legacyEaseFactor
            : existing && existing.easeFactor,
        masteryScore:
          schedule && schedule.legacyMasteryScore != null
            ? schedule.legacyMasteryScore
            : existing && existing.masteryScore,
        nextReviewBucket: existing && existing.nextReviewBucket,
        schedule,
      });
      stats[item.word] = record;
    });

    const queue = buildQueue(stats, now, existingQueue, touched);
    const summary = learningState.buildLearningSummary(stats, queue);
    return { stats, queue, summary, progress };
  }

  const api = {
    STORAGE_KEY,
    generateDeviceId,
    createEmptyBundle,
    normalizeState,
    createState,
    ensureState,
    findEvent,
    createExtensionEvent,
    appendEvents,
    mergeIncoming,
    exportBundle,
    hasFormalSchedule,
    buildProjection,
  };

  globalScope.BackgroundLearningData = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
