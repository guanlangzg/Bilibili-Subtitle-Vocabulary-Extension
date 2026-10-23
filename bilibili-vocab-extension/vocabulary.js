(function (globalScope) {
  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);
  const adaptiveTuning =
    globalScope.AdaptiveTuning ||
    (typeof require === 'function' ? require('./adaptiveTuning.js') : null);
  const Pure =
    globalScope.VocabularyPure ||
    (typeof require === 'function' ? require('./vocabulary-pure.js') : null);

  const {
    LEVELS,
    LEVEL_PRIORITY,
    DEFAULT_ACTIVE_LEVELS,
    ADAPTIVE_FEEDBACK_ACTIONS,
    normalizeLevel,
    normalizeWordKey,
    normalizeActiveLevels,
    normalizeHitCount,
    normalizeLastSeen,
    normalizeReviewBucket,
    getIntervalByBucket,
    normalizeIntervalDays,
    normalizeEaseFactor,
    normalizeEntry,
    toWordStat,
    toLearningRecord,
    normalizeStoredStats,
    normalizeLearningStats,
    getLevelPriority,
    getLevelClass,
    getCandidatePriority,
    isMatchableTerm,
    COMPOUND_SUFFIXES,
    applyLearningRecordToEntry,
  } = Pure;

  const LEVEL_FILES = {
    CET4: 'data/cet4.json',
    CET6: 'data/cet6.json',
    KAOYAN: 'data/kaoyan.json',
    IELTS: 'data/ielts.json',
    TOEFL: 'data/toefl.json',
  };

  const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
  const LEARNING_WORD_STATS_STORAGE_KEY = learningState
    ? learningState.STORAGE_KEYS.WORD_STATS_V2
    : 'bili_vocab_word_stats_v2';
  const REVIEW_QUEUE_STORAGE_KEY = learningState
    ? learningState.STORAGE_KEYS.REVIEW_QUEUE
    : 'bili_vocab_review_queue_v1';
  const LEARNING_SUMMARY_STORAGE_KEY = learningState
    ? learningState.STORAGE_KEYS.LEARNING_SUMMARY
    : 'bili_vocab_learning_summary_v1';
  const STORAGE_THROTTLE_MS = 600;
  const logError =
    globalThis.Utils && typeof globalThis.Utils.logError === 'function'
      ? globalThis.Utils.logError
      : (context, error) => console.error(`[BiliVocab] ${context}:`, error);

  let vocabularyEntries = [];
  let loadPromise = null;
  const chineseTokenIndex = new Map();
  let chineseTokenMaxLength = 2;
  // Levels whose rows include a curated `core` tier; recomputed with the index.
  let coreLevelsInDataset = new Set();
  const wordIndex = new Map();
  // One learning record exists per word, so every level entry sharing a word must show it.
  const wordEntriesIndex = new Map();
  let persistTimer = null;
  let persistChain = Promise.resolve();
  let reviewQueue = {};
  const learningHitOutbox = [];
  let learningHitOutboxFlushPromise = null;
  const LEARNING_HIT_OUTBOX_LIMIT = 100;

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

  function hasChromeLocalStorage() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' &&
      typeof chrome.storage.local.set === 'function'
    );
  }

  function hasChromeRuntimeMessaging() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function'
    );
  }

  function sendRuntimeMessage(type, payload) {
    if (!hasChromeRuntimeMessaging()) {
      return Promise.reject(new Error('chrome.runtime.sendMessage unavailable'));
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(createStorageError('chrome.runtime.sendMessage failed', runtimeError));
          return;
        }
        if (!response || response.ok !== true) {
          reject(new Error(String((response && response.error) || 'runtime message failed')));
          return;
        }
        resolve(response.payload);
      });
    });
  }

  function createEventId() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    // Opaque retry-stable fallback for contexts without Web Crypto.
    return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function enqueueLearningHitOutbox(entry) {
    learningHitOutbox.push(entry);
    while (learningHitOutbox.length > LEARNING_HIT_OUTBOX_LIMIT) {
      learningHitOutbox.shift();
    }
  }

  function flushLearningHitOutbox() {
    if (learningHitOutboxFlushPromise) {
      return learningHitOutboxFlushPromise;
    }
    if (learningHitOutbox.length === 0) {
      return Promise.resolve(null);
    }

    learningHitOutboxFlushPromise = (async () => {
      while (learningHitOutbox.length > 0) {
        const entry = learningHitOutbox[0];
        try {
          await sendRuntimeMessage('BILI_VOCAB_LEARNING_RECORD_HIT', entry);
          learningHitOutbox.shift();
        } catch (error) {
          logError('Vocabulary hit outbox flush failed', error);
          break;
        }
      }
      return null;
    })().finally(() => {
      learningHitOutboxFlushPromise = null;
    });

    return learningHitOutboxFlushPromise;
  }

  function persistLearningHit(record, payload, now, eventId) {
    const messagePayload = {
      ...payload,
      record,
      now,
      eventId,
    };
    return sendRuntimeMessage('BILI_VOCAB_LEARNING_RECORD_HIT', messagePayload)
      .then((result) => {
        void flushLearningHitOutbox();
        return result;
      })
      .catch((error) => {
        logError('Vocabulary hit background persist failed', error);
        // The outbox entry keeps the original eventId so a retry is deduplicated
        // by the background instead of counting the exposure twice.
        enqueueLearningHitOutbox(messagePayload);
        return null;
      });
  }

  function persistLearningReviewFeedback(word, action, now, eventId) {
    return sendRuntimeMessage('BILI_VOCAB_LEARNING_APPLY_REVIEW_FEEDBACK', {
      word,
      action,
      now,
      eventId,
    });
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

  function queuePersistOperation(task) {
    const run = persistChain.catch(() => {}).then(task);
    persistChain = run.catch(() => {});
    return run;
  }

  function getEmptyStoredData() {
    return {
      legacyStats: {},
      learningRecords: {},
      queue: {},
      summary: learningState ? learningState.buildLearningSummary({}, {}) : null,
    };
  }

  function readStoredStats() {
    if (!hasChromeLocalStorage()) {
      return Promise.resolve(getEmptyStoredData());
    }

    return readChromeLocalStorage([
      WORD_STATS_STORAGE_KEY,
      LEARNING_WORD_STATS_STORAGE_KEY,
      REVIEW_QUEUE_STORAGE_KEY,
      LEARNING_SUMMARY_STORAGE_KEY,
    ]).then((payload) => {
      const legacyStats = normalizeStoredStats(payload[WORD_STATS_STORAGE_KEY]);
      const learningRecords = normalizeLearningStats(
        payload[LEARNING_WORD_STATS_STORAGE_KEY],
        legacyStats
      );
      const queue = learningState
        ? learningState.normalizeReviewQueue(payload[REVIEW_QUEUE_STORAGE_KEY])
        : {};
      const summary =
        payload[LEARNING_SUMMARY_STORAGE_KEY] &&
        typeof payload[LEARNING_SUMMARY_STORAGE_KEY] === 'object'
          ? payload[LEARNING_SUMMARY_STORAGE_KEY]
          : learningState
            ? learningState.buildLearningSummary(learningRecords, queue)
            : null;

      return {
        legacyStats,
        learningRecords,
        queue,
        summary,
      };
    });
  }

  function buildActiveLearningRecords(entries = vocabularyEntries) {
    return entries.reduce((accumulator, item) => {
      const itemKey = normalizeWordKey(item.word);
      if (!itemKey) {
        return accumulator;
      }

      const hasState =
        normalizeHitCount(item.hitCount) > 0 ||
        normalizeHitCount(item.exposureCount) > 0 ||
        normalizeHitCount(item.reviewCount) > 0 ||
        normalizeHitCount(item.seenCount) > 0 ||
        normalizeHitCount(item.saveCount) > 0;
      if (hasState) {
        accumulator[itemKey] = toLearningRecord(item);
      }
      return accumulator;
    }, {});
  }

  function createPersistSnapshot(
    entries = vocabularyEntries,
    queueState = reviewQueue,
    summary = null
  ) {
    const stats = {};
    const learningStats = buildActiveLearningRecords(entries);
    entries.forEach((entry) => {
      const hitCount = normalizeHitCount(entry.hitCount);
      const exposureCount = normalizeHitCount(
        entry.exposureCount != null ? entry.exposureCount : entry.hitCount
      );
      const seenCount = normalizeHitCount(entry.seenCount || entry.hitCount);
      const reviewCount = normalizeHitCount(entry.reviewCount);
      const saveCount = normalizeHitCount(entry.saveCount);
      if (
        hitCount <= 0 &&
        exposureCount <= 0 &&
        seenCount <= 0 &&
        reviewCount <= 0 &&
        saveCount <= 0
      ) {
        return;
      }

      const key = normalizeWordKey(entry.word);
      if (!key) {
        return;
      }

      stats[key] = toWordStat(entry);
    });

    const nextSummary =
      summary ||
      (learningState ? learningState.buildLearningSummary(learningStats, queueState) : null);
    return {
      stats,
      learningStats,
      queue: queueState,
      summary: nextSummary,
    };
  }

  function writeStoredStats(snapshot = createPersistSnapshot()) {
    const { stats, learningStats, queue, summary } = snapshot;
    return writeChromeLocalStorage({
      [WORD_STATS_STORAGE_KEY]: stats,
      [LEARNING_WORD_STATS_STORAGE_KEY]: learningStats,
      [REVIEW_QUEUE_STORAGE_KEY]: queue,
      [LEARNING_SUMMARY_STORAGE_KEY]: summary,
    });
  }

  function scheduleStatsPersist() {
    if (!hasChromeLocalStorage()) {
      return;
    }

    if (persistTimer) {
      return;
    }

    persistTimer = setTimeout(() => {
      persistTimer = null;
      queuePersistOperation(() => {
        return writeStoredStats().catch((error) => {
          logError('Vocabulary stats write failed', error);
        });
      });
    }, STORAGE_THROTTLE_MS);
  }

  function maybePersistAdaptiveFeedback(action, now = Date.now()) {
    if (!adaptiveTuning || typeof adaptiveTuning.persistFeedback !== 'function') {
      return;
    }

    const normalized = String(action || '')
      .trim()
      .toLowerCase();
    if (!ADAPTIVE_FEEDBACK_ACTIONS.has(normalized)) {
      return;
    }

    try {
      const result = adaptiveTuning.persistFeedback(normalized, { now });
      if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (_error) {
      // Ignore adaptive tuning failure; main learning flow should keep working.
    }
  }

  // Learning updates must preserve the level entry selected for wordIndex.
  function replaceIndexedEntryRefs(oldEntry, newEntry) {
    if (!oldEntry || !newEntry) {
      return;
    }

    const key = normalizeWordKey(newEntry.word);
    if (key && wordIndex.get(key) === oldEntry) {
      wordIndex.set(key, newEntry);
    }

    const grouped = key ? wordEntriesIndex.get(key) : null;
    if (grouped) {
      for (let index = 0; index < grouped.length; index += 1) {
        if (grouped[index] === oldEntry) {
          grouped[index] = newEntry;
        }
      }
    }

    const terms = Array.isArray(oldEntry.matchTerms) ? oldEntry.matchTerms : [];
    terms.forEach((term) => {
      const bucket = chineseTokenIndex.get(term);
      if (!bucket) {
        return;
      }
      for (let index = 0; index < bucket.length; index += 1) {
        if (bucket[index] === oldEntry) {
          bucket[index] = newEntry;
        }
      }
    });
  }

  function replaceEntryInIndexes(oldEntry, newEntry) {
    if (!oldEntry || !newEntry) {
      return;
    }

    const entryIndex = vocabularyEntries.indexOf(oldEntry);
    if (entryIndex >= 0) {
      vocabularyEntries[entryIndex] = newEntry;
    }
    replaceIndexedEntryRefs(oldEntry, newEntry);
  }

  function applyRecordToWordEntries(wordKey, record) {
    const entries = wordEntriesIndex.get(wordKey);
    if (!entries || !record) {
      return;
    }

    // Snapshot first: the shared helper rewrites this bucket in place.
    entries.slice().forEach((entry) => {
      replaceEntryInIndexes(entry, applyLearningRecordToEntry(entry, record));
    });
  }

  function applyStoredStats(entries, storedData) {
    const records = storedData && storedData.learningRecords ? storedData.learningRecords : {};
    entries.forEach((entry, index) => {
      const key = normalizeWordKey(entry.word);
      if (!key || !records[key]) {
        return;
      }

      const updated = applyLearningRecordToEntry(entry, records[key]);
      entries[index] = updated;
      replaceIndexedEntryRefs(entry, updated);
    });

    reviewQueue = storedData && storedData.queue ? { ...storedData.queue } : {};
  }

  // `core` narrows to the curated tier, but IELTS/TOEFL carry no core entries and
  // a publish build has none at any level. Deciding per token would let those
  // levels leak `full` words in while other tokens stay hidden, so the fallback is
  // decided per level: a level with no core rows contributes its full tier.
  function collectCoreLevelDataset(entries) {
    const coreLevels = new Set();
    const levels = new Set();
    (entries || []).forEach((entry) => {
      if (!entry.level) {
        return;
      }
      levels.add(entry.level);
      if (entry.coverageTier === 'core') {
        coreLevels.add(entry.level);
      }
    });
    return { coreLevels, levels };
  }

  function rebuildIndex(entries) {
    chineseTokenIndex.clear();
    wordIndex.clear();
    wordEntriesIndex.clear();
    chineseTokenMaxLength = 2;

    entries.forEach((entry) => {
      const wordKey = normalizeWordKey(entry.word);
      if (wordKey) {
        wordIndex.set(wordKey, entry);
        if (!wordEntriesIndex.has(wordKey)) {
          wordEntriesIndex.set(wordKey, []);
        }
        wordEntriesIndex.get(wordKey).push(entry);
      }

      const terms = Array.isArray(entry.matchTerms) ? entry.matchTerms : [];
      terms.forEach((term) => {
        if (!isMatchableTerm(term)) {
          return;
        }

        if (!chineseTokenIndex.has(term)) {
          chineseTokenIndex.set(term, []);
          chineseTokenMaxLength = Math.max(chineseTokenMaxLength, Array.from(term).length);
        }

        chineseTokenIndex.get(term).push(entry);
      });
    });

    coreLevelsInDataset = collectCoreLevelDataset(entries).coreLevels;
  }

  async function fetchLevelVocabulary(level) {
    const filePath = LEVEL_FILES[level];
    const response = await fetch(chrome.runtime.getURL(filePath));
    if (!response.ok) {
      throw new Error(`Failed to load ${filePath}`);
    }

    const json = await response.json();
    if (!Array.isArray(json)) {
      throw new Error(`${filePath} must be an array`);
    }

    return json.map((item) => normalizeEntry(item, level));
  }

  async function loadVocabulary() {
    if (vocabularyEntries.length > 0) {
      return vocabularyEntries;
    }

    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = Promise.all([
      Promise.all(LEVELS.map((level) => fetchLevelVocabulary(level))),
      readStoredStats().catch((error) => {
        logError('Vocabulary stats read failed', error);
        return getEmptyStoredData();
      }),
    ])
      .then(([results, storedData]) => {
        vocabularyEntries = results
          .flat()
          .filter((entry) => Boolean(entry.word) && Boolean(entry.meaning) && Boolean(entry.level));

        applyStoredStats(vocabularyEntries, storedData);
        rebuildIndex(vocabularyEntries);
        return vocabularyEntries;
      })
      .catch((error) => {
        logError('Vocabulary load error', error);
        vocabularyEntries = [];
        chineseTokenIndex.clear();
        wordIndex.clear();
        wordEntriesIndex.clear();
        return vocabularyEntries;
      })
      .finally(() => {
        loadPromise = null;
      });

    return loadPromise;
  }

  async function refreshLearningStateFromStorage() {
    const storedData = await readStoredStats();
    // applyStoredStats refreshes index references in place; rebuilding here would
    // re-scan the fixed catalog on every cross-tab learning write.
    applyStoredStats(vocabularyEntries, storedData);
    return vocabularyEntries;
  }

  // Cached because Intl.Segmenter construction is comparatively expensive and
  // subtitles arrive once per line.
  let segmenterInstance;
  function getSegmenter() {
    if (segmenterInstance !== undefined) {
      return segmenterInstance;
    }
    segmenterInstance =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('zh', { granularity: 'word' })
        : null;
    return segmenterInstance;
  }

  function segmentWords(source) {
    const segmenter = getSegmenter();
    if (!segmenter) {
      return null;
    }
    return Array.from(segmenter.segment(source), (item) => ({
      text: item.segment,
      index: item.index,
    }));
  }

  // `core` narrows to the curated tier. Some datasets have no core rows at all for
  // the user's levels (IELTS/TOEFL, and every level in a publish build), so the
  // mode falls back to the full tier for those levels instead of replacing
  // nothing. Whether a fallback is in effect is decided once per call, because a
  // per-token decision would leak full-tier words next to core ones.
  function resolveCoreFallback(allowedLevels) {
    for (const level of allowedLevels) {
      if (coreLevelsInDataset.has(level)) {
        return false;
      }
    }
    return true;
  }

  function resolveSelectedEntry(
    token,
    allowedLevels,
    vocabularyMode,
    selectedCache,
    allowFullTier
  ) {
    if (selectedCache.has(token)) {
      return selectedCache.get(token);
    }

    const candidates = chineseTokenIndex.get(token);
    let selectedEntry = null;
    if (candidates) {
      const levelCandidates = candidates.filter((entry) => allowedLevels.has(entry.level));
      const filtered =
        vocabularyMode === 'core' && !allowFullTier
          ? levelCandidates.filter((entry) => entry.coverageTier === 'core')
          : levelCandidates;

      if (filtered.length > 0) {
        selectedEntry =
          filtered.length === 1
            ? filtered[0]
            : filtered.reduce((best, curr) => {
                return getCandidatePriority(curr, vocabularyMode) >
                  getCandidatePriority(best, vocabularyMode)
                  ? curr
                  : best;
              });
      }
    }

    selectedCache.set(token, selectedEntry);
    return selectedEntry;
  }

  function buildMatch(start, end, token, selectedEntry) {
    return {
      start,
      end,
      chinese: token,
      word: selectedEntry.word,
      meaning: selectedEntry.meaning,
      level: selectedEntry.level,
      cefrLevel: selectedEntry.cefrLevel,
      cefrRank: selectedEntry.cefrRank,
      frequency: selectedEntry.frequency,
      coverageTier: selectedEntry.coverageTier,
      sourceFlags: selectedEntry.sourceFlags,
      altMeanings: selectedEntry.altMeanings,
      examFrequencyScore: selectedEntry.examFrequencyScore,
      examPriorityScore: selectedEntry.examPriorityScore,
      learningStatus: selectedEntry.learningStatus,
      isPhraseBacked: selectedEntry.isPhraseBacked,
      phraseCount: selectedEntry.phraseCount,
      phonetic: selectedEntry.phonetic,
      partOfSpeech: selectedEntry.partOfSpeech,
      definition: selectedEntry.definition,
    };
  }

  // Matches only inside word boundaries. Substring matching broke compounds apart
  // (电影院 → film院, 一个人 → company个人), so the source is segmented first and
  // spans never cross a segment boundary.
  function collectSegmentedMatches(
    source,
    allowedLevels,
    vocabularyMode,
    selectedCache,
    allowFullTier
  ) {
    const words = segmentWords(source);
    if (!words) {
      return null;
    }

    const matches = [];
    for (let index = 0; index < words.length; index += 1) {
      let consumed = 0;
      for (
        let length = Math.min(chineseTokenMaxLength, words.length - index);
        length >= 1;
        length -= 1
      ) {
        const span = words.slice(index, index + length);
        const token = span.map((word) => word.text).join('');
        if (!isMatchableTerm(token)) {
          continue;
        }

        // A trailing single character that forms a longer word means this span is
        // only a fragment (孩子 + 们, 电影 + 院).
        const nextWord = words[index + length];
        if (
          nextWord &&
          Array.from(nextWord.text).length === 1 &&
          COMPOUND_SUFFIXES.has(nextWord.text)
        ) {
          continue;
        }

        const selectedEntry = resolveSelectedEntry(
          token,
          allowedLevels,
          vocabularyMode,
          selectedCache,
          allowFullTier
        );
        if (!selectedEntry) {
          continue;
        }

        const lastWord = span[span.length - 1];
        matches.push(
          buildMatch(span[0].index, lastWord.index + lastWord.text.length, token, selectedEntry)
        );
        consumed = length;
        break;
      }
      if (consumed > 1) {
        index += consumed - 1;
      }
    }

    return matches;
  }

  // Fallback for runtimes without Intl.Segmenter: scan longest-first, but still
  // reject spans followed by a compound suffix.
  function collectSubstringMatches(
    source,
    allowedLevels,
    vocabularyMode,
    selectedCache,
    allowFullTier
  ) {
    const matches = [];
    const tokens = Array.from(chineseTokenIndex.keys()).sort(
      (left, right) => Array.from(right).length - Array.from(left).length
    );

    tokens.forEach((token) => {
      let fromIndex = 0;
      while (fromIndex < source.length) {
        const foundIndex = source.indexOf(token, fromIndex);
        if (foundIndex < 0) {
          break;
        }
        const after = source.slice(foundIndex + token.length);
        const nextChar = Array.from(after)[0];
        const blocked = Boolean(nextChar && COMPOUND_SUFFIXES.has(nextChar));

        if (!blocked) {
          const selectedEntry = resolveSelectedEntry(
            token,
            allowedLevels,
            vocabularyMode,
            selectedCache,
            allowFullTier
          );
          if (selectedEntry) {
            matches.push(buildMatch(foundIndex, foundIndex + token.length, token, selectedEntry));
          }
        }

        fromIndex = foundIndex + token.length;
      }
    });

    return matches;
  }

  function findMatchesInText(text, activeLevels, selectionSettings) {
    const source = String(text || '');
    if (!source) {
      return [];
    }

    const allowedLevels = new Set(normalizeActiveLevels(activeLevels));
    const vocabularyMode = selectionSettings
      ? sharedSettings
        ? sharedSettings.normalizeVocabularyMode(selectionSettings.vocabularyMode)
        : 'core'
      : 'full';
    const selectedCache = new Map();
    const allowFullTier = vocabularyMode === 'core' ? resolveCoreFallback(allowedLevels) : true;
    const matches =
      collectSegmentedMatches(
        source,
        allowedLevels,
        vocabularyMode,
        selectedCache,
        allowFullTier
      ) ??
      collectSubstringMatches(source, allowedLevels, vocabularyMode, selectedCache, allowFullTier);

    matches.sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start;
      }

      const lengthDiff = b.end - b.start - (a.end - a.start);
      if (lengthDiff !== 0) {
        return lengthDiff;
      }

      return getLevelPriority(b.level) - getLevelPriority(a.level);
    });

    const uniqueBySpan = new Map();
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const key = `${match.start}-${match.end}`;
      if (!uniqueBySpan.has(key)) {
        uniqueBySpan.set(key, match);
      }
    }

    return Array.from(uniqueBySpan.values());
  }

  function recordHit(word) {
    const key = normalizeWordKey(word);
    if (!key) {
      return false;
    }

    const entry = wordIndex.get(key);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (learningState) {
      const previousRecord = toLearningRecord(entry);
      const exposurePayload = {
        word: entry.word,
        translation: entry.translation || entry.meaning,
        level: entry.level,
        sourceLevels: entry.sourceLevels || [entry.level],
      };
      const nextRecord = learningState.recordExposure(previousRecord, exposurePayload, now);
      applyRecordToWordEntries(key, nextRecord);
      reviewQueue = learningState.syncReviewQueue(reviewQueue, nextRecord, now);
      void persistLearningHit(previousRecord, exposurePayload, now, createEventId());
    } else {
      entry.hitCount = normalizeHitCount(entry.hitCount) + 1;
      entry.lastSeen = now;
      scheduleStatsPersist();
    }

    if (learningState && typeof learningState.updateLearningStreak === 'function') {
      void learningState.updateLearningStreak(now);
    }
    return true;
  }

  function getReviewQueue(limit = 5) {
    if (!learningState) {
      return [];
    }

    const bucketRank = {
      today: 0,
      soon: 1,
      later: 2,
    };

    return Object.values(reviewQueue || {})
      .map((item) => {
        const entry = wordIndex.get(normalizeWordKey(item.word));
        if (!entry) {
          return null;
        }
        const dueBucket = normalizeReviewBucket(item.dueBucket || entry.nextReviewBucket);
        const nextReviewAt = normalizeLastSeen(item.nextReviewAt || entry.nextReviewAt);
        const intervalDays = normalizeIntervalDays(
          item.intervalDays,
          getIntervalByBucket(dueBucket)
        );
        const easeFactor = normalizeEaseFactor(item.easeFactor, entry.easeFactor);
        const updatedAt = normalizeLastSeen(item.updatedAt);
        const lastSeenAt = normalizeLastSeen(item.lastSeenAt || entry.lastSeenAt || entry.lastSeen);
        return {
          word: entry.word,
          translation: entry.translation || entry.meaning,
          level: entry.level,
          status: entry.learningStatus || 'unseen',
          dueBucket,
          nextReviewAt,
          intervalDays,
          easeFactor,
          updatedAt,
          lastSeenAt,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftRank = Object.prototype.hasOwnProperty.call(bucketRank, left.dueBucket)
          ? bucketRank[left.dueBucket]
          : 9;
        const rightRank = Object.prototype.hasOwnProperty.call(bucketRank, right.dueBucket)
          ? bucketRank[right.dueBucket]
          : 9;
        const bucketDiff = leftRank - rightRank;
        if (bucketDiff !== 0) {
          return bucketDiff;
        }
        const leftDue = Number.isFinite(left.nextReviewAt)
          ? left.nextReviewAt
          : Number.POSITIVE_INFINITY;
        const rightDue = Number.isFinite(right.nextReviewAt)
          ? right.nextReviewAt
          : Number.POSITIVE_INFINITY;
        if (leftDue !== rightDue) {
          return leftDue - rightDue;
        }
        const leftUpdated = left.updatedAt || left.lastSeenAt || 0;
        const rightUpdated = right.updatedAt || right.lastSeenAt || 0;
        if (rightUpdated !== leftUpdated) {
          return rightUpdated - leftUpdated;
        }
        return String(left.word || '').localeCompare(String(right.word || ''));
      })
      .slice(0, limit);
  }

  async function applyLearningAction(word, action) {
    if (!learningState) {
      return null;
    }

    return queuePersistOperation(async () => {
      const key = normalizeWordKey(word);
      const entry = wordIndex.get(key);
      if (!entry) {
        return null;
      }

      const now = Date.now();
      const normalizedAction = String(action || '')
        .trim()
        .toLowerCase();
      let committedPayload = null;
      try {
        committedPayload = await persistLearningReviewFeedback(
          key,
          normalizedAction,
          now,
          createEventId()
        );
      } catch (error) {
        logError('Vocabulary learning action write failed', error);
        return null;
      }

      const committedRecord =
        committedPayload &&
        committedPayload.stats &&
        typeof committedPayload.stats === 'object' &&
        committedPayload.stats[key]
          ? committedPayload.stats[key]
          : typeof learningState.applyLearningAction === 'function'
            ? learningState.applyLearningAction(toLearningRecord(entry), normalizedAction, now)
            : learningState.applyReviewFeedback(toLearningRecord(entry), normalizedAction, now);
      const updated = applyLearningRecordToEntry(entry, committedRecord);
      replaceEntryInIndexes(entry, updated);
      applyRecordToWordEntries(key, committedRecord);
      reviewQueue =
        committedPayload && committedPayload.queue && typeof committedPayload.queue === 'object'
          ? learningState.normalizeReviewQueue(committedPayload.queue)
          : learningState.syncReviewQueue(reviewQueue, committedRecord, now);
      maybePersistAdaptiveFeedback(normalizedAction, now);
      if (typeof learningState.updateLearningStreak === 'function') {
        void learningState.updateLearningStreak(now);
      }
      return committedRecord;
    });
  }

  async function reviewWord(word, feedback) {
    return applyLearningAction(word, feedback);
  }

  function getEncounteredWords() {
    return vocabularyEntries
      .filter((entry) => normalizeHitCount(entry.hitCount) > 0)
      .map((entry) => {
        return {
          word: entry.word,
          translation: entry.translation || entry.meaning,
          meaning: entry.meaning,
          level: entry.level,
          hitCount: normalizeHitCount(entry.hitCount),
          lastSeen: normalizeLastSeen(entry.lastSeen),
        };
      });
  }

  function __setEntriesForTest(entries) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    persistChain = Promise.resolve();
    reviewQueue = {};
    vocabularyEntries = Array.isArray(entries)
      ? entries.map((entry) => normalizeEntry(entry, normalizeLevel(entry.level) || 'CET4'))
      : [];
    rebuildIndex(vocabularyEntries);
    return vocabularyEntries;
  }

  const api = {
    LEVELS,
    LEVEL_PRIORITY,
    DEFAULT_ACTIVE_LEVELS,
    WORD_STATS_STORAGE_KEY,
    normalizeLevel,
    normalizeActiveLevels,
    getLevelPriority,
    getLevelClass,
    loadVocabulary,
    refreshLearningStateFromStorage,
    findMatchesInText,
    recordHit,
    flushLearningHitOutbox,
    applyLearningAction,
    reviewWord,
    getReviewQueue,
    getEncounteredWords,
    __setEntriesForTest,
  };

  globalScope.VocabularyModule = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
