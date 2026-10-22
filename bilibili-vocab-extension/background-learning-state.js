(function (globalScope) {
  // Dependencies are loaded by background.js importScripts before this module.
  // In Node tests, require() provides the same modules.
  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);
  const backgroundStorage =
    globalScope.BackgroundStorage ||
    (typeof require === 'function' ? require('./background-storage.js') : null);
  const learningDataApi =
    globalScope.LearningData ||
    (typeof require === 'function' ? require('./learningData.js') : null);
  const backgroundLearningData =
    globalScope.BackgroundLearningData ||
    (typeof require === 'function' ? require('./background-learning-data.js') : null);

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
  const LEARNING_DATA_STORAGE_KEY = backgroundLearningData
    ? backgroundLearningData.STORAGE_KEY
    : 'bili_vocab_learning_data_v1';

  const getStoragePayload = backgroundStorage && backgroundStorage.getStoragePayload;
  const writeStoragePayload = backgroundStorage && backgroundStorage.writeStoragePayload;
  const normalizeTimestamp = backgroundStorage && backgroundStorage.normalizeTimestamp;

  // Holds a migration until its first atomic write so concurrent reads in the
  // same service-worker lifetime keep the same device id and baselines.
  let pendingMigrationState = null;

  function normalizeWordKey(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function requireLearningModules() {
    if (!learningState) {
      throw new Error('LearningState unavailable');
    }
    if (!learningDataApi || !backgroundLearningData) {
      throw new Error('LearningData unavailable');
    }
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

  function createEventId() {
    requireLearningModules();
    return learningDataApi.randomId();
  }

  function normalizeBookCodes(value, fallbackRecord) {
    const source = Array.isArray(value)
      ? value
      : fallbackRecord && Array.isArray(fallbackRecord.sourceLevels)
        ? fallbackRecord.sourceLevels
        : fallbackRecord && Array.isArray(fallbackRecord.bookCodes)
          ? fallbackRecord.bookCodes
          : fallbackRecord && fallbackRecord.level
            ? [fallbackRecord.level]
            : [];
    return learningDataApi.BOOK_CODES.filter((code) => source.includes(code));
  }

  function normalizeTimeSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return seconds;
  }

  function buildEventContext(payload, record) {
    const rawContext = payload.context;
    const source =
      payload.source && typeof payload.source === 'object'
        ? payload.source
        : record && record.source && typeof record.source === 'object'
          ? record.source
          : null;
    const sentence =
      typeof rawContext === 'string'
        ? rawContext.trim()
        : rawContext && typeof rawContext === 'object'
          ? rawContext.sentence
          : record && record.context
            ? record.context
            : '';
    const title = (source && source.title) || (rawContext && rawContext.title) || '';
    const url = (source && source.url) || (rawContext && rawContext.url) || '';
    const timeSeconds = normalizeTimeSeconds(
      source && source.timeSeconds != null
        ? source.timeSeconds
        : rawContext && rawContext.timeSeconds
    );
    if (!sentence && !title && !url && timeSeconds == null) {
      return null;
    }
    return {
      sentence: sentence || null,
      title: title || null,
      url: url || null,
      timeSeconds,
    };
  }

  function buildEvent(snapshot, payload, word, record, type, extra = {}) {
    const occurredAt =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const zoneId =
      payload.zoneId ||
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : 'UTC');
    const utcOffsetMinutes = Number.isInteger(payload.utcOffsetMinutes)
      ? payload.utcOffsetMinutes
      : -new Date(occurredAt).getTimezoneOffset();
    return backgroundLearningData.createExtensionEvent(snapshot.state, {
      eventId: payload.eventId,
      type,
      word,
      occurredAt,
      zoneId,
      utcOffsetMinutes,
      bookCodes: normalizeBookCodes(payload.bookCodes, record),
      context: buildEventContext(payload, record),
      rawAction: payload.rawAction == null ? null : String(payload.rawAction),
      durationMs: payload.durationMs == null ? null : payload.durationMs,
      ...extra,
    });
  }

  function eventFingerprint(event) {
    return learningDataApi.canonical({
      eventId: event.eventId,
      wordId: event.wordId,
      word: event.word,
      type: event.type,
      occurredAt: event.occurredAt,
      localDay: event.localDay,
      zoneId: event.zoneId,
      utcOffsetMinutes: event.utcOffsetMinutes,
      bookCodes: event.bookCodes,
      rating: event.rating,
      rawAction: event.rawAction,
      durationMs: event.durationMs,
      targetRetention: event.targetRetention,
      algorithm: event.algorithm,
      algorithmVersion: event.algorithmVersion,
      context: event.context,
    });
  }

  // A retry must carry the same id and the same client-owned fields. The
  // schedule is derived by the background, so it is deliberately excluded.
  function resolveDuplicate(snapshot, candidate) {
    const existing = backgroundLearningData.findEvent(snapshot.state, candidate.eventId);
    if (!existing) {
      return null;
    }
    if (eventFingerprint(existing) !== eventFingerprint(candidate)) {
      throw new Error(`Conflicting eventId: ${candidate.eventId}`);
    }
    return existing;
  }

  function resultFromSnapshot(snapshot, extra = {}) {
    return {
      stats: snapshot.stats,
      queue: snapshot.queue,
      summary: snapshot.summary,
      ...extra,
    };
  }

  async function readLearningSnapshot() {
    requireLearningModules();
    if (typeof getStoragePayload !== 'function') {
      throw new Error('background storage unavailable');
    }

    const payload = await getStoragePayload([
      WORD_STATS_STORAGE_KEY,
      LEARNING_WORD_STATS_STORAGE_KEY,
      REVIEW_QUEUE_STORAGE_KEY,
      LEARNING_SUMMARY_STORAGE_KEY,
      LEARNING_DATA_STORAGE_KEY,
    ]);
    let stats = normalizeStatsMap(payload[LEARNING_WORD_STATS_STORAGE_KEY]);
    if (Object.keys(stats).length === 0) {
      stats = migrateLegacyStats(payload[WORD_STATS_STORAGE_KEY]);
    }
    const queue = normalizeQueue(payload[REVIEW_QUEUE_STORAGE_KEY]);
    const rawState = payload[LEARNING_DATA_STORAGE_KEY];
    let state = null;
    let needsMigration = false;
    if (rawState != null) {
      state = backgroundLearningData.normalizeState(rawState);
      pendingMigrationState = null;
    } else {
      needsMigration = true;
      state = pendingMigrationState || backgroundLearningData.createState(stats, Date.now());
      pendingMigrationState = state;
    }
    return {
      stats,
      queue,
      summary: buildSummary(stats, queue),
      state,
      needsMigration,
    };
  }

  async function writeLearningSnapshot(stats, queue, state) {
    if (typeof writeStoragePayload !== 'function') {
      throw new Error('background storage unavailable');
    }
    const summary = buildSummary(stats, queue);
    // One atomic set for the journal and every projection it drives. Use the
    // raw writer so quota recovery can never delete this round's events.
    await writeStoragePayload({
      [WORD_STATS_STORAGE_KEY]: buildLegacyStats(stats),
      [LEARNING_WORD_STATS_STORAGE_KEY]: stats,
      [REVIEW_QUEUE_STORAGE_KEY]: queue,
      [LEARNING_SUMMARY_STORAGE_KEY]: summary,
      [LEARNING_DATA_STORAGE_KEY]: state,
    });
    pendingMigrationState = null;
    return { stats, queue, summary };
  }

  function buildProjection(state, stats, now, overrides = {}, queue, touchedWords) {
    const existingStats = { ...(stats || {}), ...overrides };
    const projection = backgroundLearningData.buildProjection(
      state,
      existingStats,
      now,
      queue,
      touchedWords
    );
    // Keep legacy reads (`record.savedAt === undefined`) working for unsaved words.
    Object.values(projection.stats).forEach((record) => {
      if (record && record.savedAt == null) {
        delete record.savedAt;
      }
    });
    return projection;
  }

  async function commitEvents(snapshot, events, overrides, now, touchedWords) {
    let state = snapshot.state;
    if (events.length > 0) {
      state = backgroundLearningData.appendEvents(state, events, now);
    }
    const touched =
      touchedWords || new Set(Object.keys(overrides || {}).map((key) => normalizeWordKey(key)));
    const projection = buildProjection(
      state,
      snapshot.stats,
      now,
      overrides,
      snapshot.queue,
      touched
    );
    const written = await writeLearningSnapshot(projection.stats, projection.queue, state);
    return {
      ...written,
      progress: projection.progress,
      state,
      eventIds: events.map((event) => event.eventId),
    };
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
      payload,
    };
  }

  async function recordLearningHit(messagePayload) {
    requireLearningModules();
    if (!learningState || typeof learningState.recordExposure !== 'function') {
      throw new Error('LearningState.recordExposure unavailable');
    }
    const hit = normalizeHitPayload(messagePayload);
    const payload = hit.payload;
    const snapshot = await readLearningSnapshot();
    const currentRecord = snapshot.stats[hit.word] || hit.record;
    const candidate = buildEvent(snapshot, payload, hit.word, currentRecord, 'exposure');
    const duplicate = resolveDuplicate(snapshot, candidate);
    if (duplicate) {
      return resultFromSnapshot(snapshot, {
        duplicate: true,
        eventId: duplicate.eventId,
        word: hit.word,
      });
    }

    const nextRecord = learningState.recordExposure(currentRecord, hit.exposure, hit.now);
    const overrides = {
      [hit.word]: {
        ...nextRecord,
        translation: hit.exposure.translation || nextRecord.translation,
        level: hit.exposure.level || nextRecord.level,
        sourceLevels: hit.exposure.sourceLevels || nextRecord.sourceLevels,
      },
    };
    const result = await commitEvents(snapshot, [candidate], overrides, hit.now);
    return { ...result, word: hit.word, eventId: candidate.eventId };
  }

  function normalizeReviewAction(action) {
    const normalized = String(action || '')
      .trim()
      .toLowerCase();
    const map = {
      know: { rating: 'good', legacy: 'know' },
      fuzzy: { rating: 'hard', legacy: 'fuzzy' },
      dontknow: { rating: 'again', legacy: 'dontknow' },
      again: { rating: 'again', legacy: 'dontknow' },
      hard: { rating: 'hard', legacy: 'fuzzy' },
      good: { rating: 'good', legacy: 'know' },
      easy: { rating: 'easy', legacy: 'know' },
    };
    return map[normalized] || null;
  }

  async function applyReviewFeedback(messagePayload) {
    requireLearningModules();
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

    if (action === 'skip' || action === 'resume') {
      const type = action === 'skip' ? 'suspend' : 'resume';
      const candidate = buildEvent(
        snapshot,
        { ...payload, rawAction: action },
        word,
        currentRecord,
        type
      );
      const duplicate = resolveDuplicate(snapshot, candidate);
      if (duplicate) {
        return resultFromSnapshot(snapshot, {
          duplicate: true,
          eventId: duplicate.eventId,
          word,
          pendingScheduling: false,
          scheduleUpdated: false,
        });
      }
      const nextRecord =
        action === 'skip'
          ? learningState.applyLearningAction(currentRecord, 'skip', now)
          : {
              ...currentRecord,
              status: currentRecord.saved
                ? 'saved'
                : currentRecord.reviewCount > 0 || currentRecord.exposureCount >= 2
                  ? 'seen'
                  : 'unseen',
            };
      if (action === 'resume') {
        nextRecord.suspended = false;
      }
      const result = await commitEvents(snapshot, [candidate], { [word]: nextRecord }, now);
      return {
        ...result,
        word,
        eventId: candidate.eventId,
        pendingScheduling: false,
        scheduleUpdated: false,
      };
    }

    const review = normalizeReviewAction(action);
    if (!review) {
      throw new Error('Review feedback unavailable');
    }
    const formalSchedule = backgroundLearningData.hasFormalSchedule(currentRecord);
    const algorithm = formalSchedule ? 'extension-pending' : learningDataApi.LEGACY_ALGORITHM;
    const algorithmVersion = formalSchedule ? '1' : learningDataApi.LEGACY_ALGORITHM_VERSION;
    const candidate = buildEvent(
      snapshot,
      { ...payload, rawAction: payload.rawAction || action },
      word,
      currentRecord,
      'review',
      {
        rating: review.rating,
        algorithm,
        algorithmVersion,
        targetRetention: null,
      }
    );
    const duplicate = resolveDuplicate(snapshot, candidate);
    if (duplicate) {
      return resultFromSnapshot(snapshot, {
        duplicate: true,
        eventId: duplicate.eventId,
        word,
        pendingScheduling: formalSchedule,
        scheduleUpdated: false,
        algorithm,
      });
    }

    let nextRecord;
    if (formalSchedule) {
      // The App's FSRS snapshot stays authoritative. The browser contributes a
      // real review rating but does not pretend to have recalculated FSRS.
      nextRecord = { ...currentRecord };
    } else {
      nextRecord = learningState.applyLearningAction(currentRecord, review.legacy, now);
      nextRecord.schedule = learningDataApi.legacySchedule({
        ...nextRecord,
        schedule: null,
        lastReviewedAt: candidate.occurredAt,
      });
      candidate.schedule = nextRecord.schedule;
    }
    const result = await commitEvents(snapshot, [candidate], { [word]: nextRecord }, now);
    return {
      ...result,
      word,
      eventId: candidate.eventId,
      pendingScheduling: formalSchedule,
      scheduleUpdated: !formalSchedule,
      algorithm,
    };
  }

  async function saveWord(messagePayload) {
    requireLearningModules();
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
    const snapshot = await readLearningSnapshot();
    const existing = snapshot.stats[word] || null;
    const candidate = buildEvent(
      snapshot,
      { ...payload, rawAction: payload.rawAction || 'save' },
      word,
      existing,
      'save'
    );
    const duplicate = resolveDuplicate(snapshot, candidate);
    if (duplicate) {
      return resultFromSnapshot(snapshot, {
        saved: true,
        duplicate: true,
        word,
        eventId: duplicate.eventId,
      });
    }

    const nextRecord = learningState.buildSavedWordRecord(word, existing, payload.details, now);
    nextRecord.saved = true;
    nextRecord.suspended = Boolean(existing && existing.suspended);
    const overrides = {
      [word]: {
        ...nextRecord,
        context: (payload.details && payload.details.context) || nextRecord.context,
        source: (payload.details && payload.details.source) || nextRecord.source,
      },
    };
    const result = await commitEvents(snapshot, [candidate], overrides, now);
    return {
      ...result,
      saved: true,
      word,
      eventId: candidate.eventId,
    };
  }

  function isSavedRecord(record) {
    return Boolean(record && (record.saved === true || record.status === 'saved'));
  }

  async function removeWord(messagePayload) {
    requireLearningModules();
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
    const existing = snapshot.stats[word] || null;
    const candidate = buildEvent(
      snapshot,
      { ...payload, rawAction: payload.rawAction || 'removeSave' },
      word,
      existing,
      'unsave'
    );
    const duplicate = resolveDuplicate(snapshot, candidate);
    if (duplicate) {
      return resultFromSnapshot(snapshot, {
        removed: true,
        duplicate: true,
        word,
        eventId: duplicate.eventId,
      });
    }
    if (!isSavedRecord(existing)) {
      return { removed: false, word };
    }

    const nextRecord = learningState.buildRemovedWordRecord(word, existing, now);
    if (!nextRecord) {
      return { removed: false, word };
    }
    nextRecord.saved = false;
    nextRecord.suspended = Boolean(existing.suspended);
    const result = await commitEvents(snapshot, [candidate], { [word]: nextRecord }, now);
    return { ...result, removed: true, word, eventId: candidate.eventId };
  }

  async function clearVocabulary(messagePayload) {
    requireLearningModules();
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const snapshot = await readLearningSnapshot();
    const savedWords = Object.keys(snapshot.stats).filter((key) =>
      isSavedRecord(snapshot.stats[key])
    );
    if (savedWords.length === 0) {
      // A no-op clear still persists a pending migration marker: the marker
      // must never live only in service-worker memory.
      if (snapshot.needsMigration) {
        if (typeof writeStoragePayload !== 'function') {
          throw new Error('background storage unavailable');
        }
        await writeStoragePayload({ [LEARNING_DATA_STORAGE_KEY]: snapshot.state });
        pendingMigrationState = null;
      }
      return { cleared: 0 };
    }
    const providedIds = Array.isArray(payload.eventIds) ? payload.eventIds : [];
    const events = savedWords.map((word, index) =>
      buildEvent(
        snapshot,
        {
          ...payload,
          eventId:
            providedIds[index] ||
            (payload.commandId
              ? `${payload.commandId}:${learningDataApi.wordId(word)}`
              : undefined),
          now,
          rawAction: 'clear',
        },
        word,
        snapshot.stats[word],
        'unsave'
      )
    );
    const overrides = {};
    savedWords.forEach((word) => {
      const nextRecord = {
        ...snapshot.stats[word],
        status: 'seen',
        saved: false,
        suspended: Boolean(snapshot.stats[word].suspended),
        // Mirrors the legacy clear: saveCount must reset or the next exposure
        // promotes the word back into the saved book.
        saveCount: 0,
      };
      delete nextRecord.savedAt;
      overrides[word] = nextRecord;
    });
    // Legacy clear leaves the review queue untouched, so only stats change.
    const result = await commitEvents(snapshot, events, overrides, now, new Set());
    return {
      ...result,
      cleared: savedWords.length,
      eventIds: events.map((event) => event.eventId),
    };
  }

  async function recordLearningLookup(messagePayload) {
    requireLearningModules();
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const word = normalizeWordKey(payload.word);
    if (!word) {
      throw new Error('Lookup word unavailable');
    }
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const snapshot = await readLearningSnapshot();
    const existing = snapshot.stats[word] || null;
    const candidate = buildEvent(snapshot, payload, word, existing, 'lookup');
    const duplicate = resolveDuplicate(snapshot, candidate);
    if (duplicate) {
      return resultFromSnapshot(snapshot, {
        word,
        duplicate: true,
        eventId: duplicate.eventId,
        lookupCount: existing ? existing.lookupCount : 0,
      });
    }
    const base =
      existing ||
      learningState.normalizeLearningRecord({
        word,
        translation: payload.translation,
        level: payload.level,
        sourceLevels: payload.sourceLevels,
        status: 'unseen',
      });
    const override = {
      ...base,
      translation: payload.translation || base.translation,
      level: payload.level || base.level,
      sourceLevels: payload.sourceLevels || base.sourceLevels,
      context: typeof payload.context === 'string' ? payload.context : base.context,
      source: payload.source || base.source,
    };
    const result = await commitEvents(snapshot, [candidate], { [word]: override }, now);
    const record = result.stats[word];
    return {
      ...result,
      word,
      eventId: candidate.eventId,
      lookupCount: record ? record.lookupCount : 0,
    };
  }

  async function initializeLearningData() {
    requireLearningModules();
    const snapshot = await readLearningSnapshot();
    if (!snapshot.needsMigration) {
      return {
        initialized: false,
        deviceId: snapshot.state.deviceId,
        baselineCount: snapshot.state.bundle.baselines.length,
      };
    }
    if (typeof writeStoragePayload !== 'function') {
      throw new Error('background storage unavailable');
    }
    await writeStoragePayload({ [LEARNING_DATA_STORAGE_KEY]: snapshot.state });
    pendingMigrationState = null;
    return {
      initialized: true,
      deviceId: snapshot.state.deviceId,
      baselineCount: snapshot.state.bundle.baselines.length,
    };
  }

  async function exportLearningData(messagePayload) {
    requireLearningModules();
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const snapshot = await readLearningSnapshot();
    if (snapshot.needsMigration) {
      if (typeof writeStoragePayload !== 'function') {
        throw new Error('background storage unavailable');
      }
      await writeStoragePayload({ [LEARNING_DATA_STORAGE_KEY]: snapshot.state });
      pendingMigrationState = null;
    }
    const bundle = backgroundLearningData.exportBundle(snapshot.state, now);
    return {
      deviceId: snapshot.state.deviceId,
      exportedAt: bundle.exportedAt,
      pendingEventCount: bundle.events.length,
      bundle,
      progress: learningDataApi.deriveProgress(bundle),
    };
  }

  async function importLearningData(messagePayload) {
    requireLearningModules();
    const payload = messagePayload && typeof messagePayload === 'object' ? messagePayload : {};
    // Validate the complete incoming bundle before touching the local store.
    const incoming = learningDataApi.normalizeBundle(payload.bundle);
    const now =
      (typeof normalizeTimestamp === 'function' && normalizeTimestamp(payload.now)) || Date.now();
    const snapshot = await readLearningSnapshot();
    const state = backgroundLearningData.mergeIncoming(snapshot.state, incoming, now);
    // Keep existing queue entries for words the bundle does not mention.
    const projection = buildProjection(state, snapshot.stats, now, {}, snapshot.queue);
    const written = await writeLearningSnapshot(projection.stats, projection.queue, state);
    return {
      imported: true,
      deviceId: state.deviceId,
      bundle: backgroundLearningData.exportBundle(state, now),
      progress: projection.progress,
      stats: written.stats,
      queue: written.queue,
      summary: written.summary,
    };
  }

  const api = {
    WORD_STATS_STORAGE_KEY,
    LEARNING_WORD_STATS_STORAGE_KEY,
    REVIEW_QUEUE_STORAGE_KEY,
    LEARNING_SUMMARY_STORAGE_KEY,
    LEARNING_DATA_STORAGE_KEY,
    createEventId,
    readLearningSnapshot,
    initializeLearningData,
    recordLearningHit,
    applyReviewFeedback,
    saveWord,
    removeWord,
    clearVocabulary,
    recordLearningLookup,
    exportLearningData,
    importLearningData,
  };

  globalScope.BackgroundLearningState = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
