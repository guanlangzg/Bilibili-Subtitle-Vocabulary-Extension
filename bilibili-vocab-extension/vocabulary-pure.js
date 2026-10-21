(function (globalScope) {
  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);

  const LEVELS = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];

  const LEVEL_CLASS_MAP = {
    CET4: 'level-cet4',
    CET6: 'level-cet6',
    KAOYAN: 'level-kaoyan',
    IELTS: 'level-ielts',
    TOEFL: 'level-toefl',
  };

  const LEVEL_PRIORITY = {
    CET4: 1,
    CET6: 2,
    KAOYAN: 3,
    IELTS: 4,
    TOEFL: 5,
  };

  const DEFAULT_ACTIVE_LEVELS = LEVELS.slice();

  const REVIEW_BUCKETS = ['today', 'soon', 'later'];
  const DEFAULT_INTERVAL_DAYS = 1;
  const DEFAULT_EASE_FACTOR = 2.3;
  const MIN_EASE_FACTOR = 1.3;
  const MAX_EASE_FACTOR = 2.8;
  const MAX_INTERVAL_DAYS = 60;
  const ADAPTIVE_FEEDBACK_ACTIONS = new Set(['know', 'fuzzy', 'dontknow']);

  function normalizeLevel(level) {
    const normalized = String(level || '')
      .trim()
      .toUpperCase();
    if (!LEVELS.includes(normalized)) {
      return '';
    }
    return normalized;
  }

  function normalizeWordKey(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function normalizeActiveLevels(levels) {
    if (!Array.isArray(levels) || levels.length === 0) {
      return DEFAULT_ACTIVE_LEVELS.slice();
    }

    const normalizedLevels = [];
    levels.forEach((level) => {
      const normalized = normalizeLevel(level);
      if (!normalized || normalizedLevels.includes(normalized)) {
        return;
      }
      normalizedLevels.push(normalized);
    });

    if (normalizedLevels.length === 0) {
      return DEFAULT_ACTIVE_LEVELS.slice();
    }

    return normalizedLevels;
  }

  // Terms that name a grammatical relation rather than a concept. Replacing them
  // produces code-switched fragments ("very（完全）", "enough（很多）") instead of a
  // readable sentence, so they are never indexed.
  const NON_TERM_TOKENS = new Set(
    (
      '关于 对于 至于 由于 为了 通过 根据 按照 随着 除了 经过 作为 成为 因为 所以 但是 而且 如果 虽然 ' +
      '然后 这样 那样 这里 那里 哪里 自己 大家 我们 你们 他们 她们 它们 别人 有人 什么 为什么 怎么样 ' +
      '一直 一定 可能 应该 需要 觉得 认为 希望 知道 喜欢 开始 发生 决定 解决 影响 变化 方式 时候 东西 ' +
      '事情 问题 一个 这个 那个 这些 那些 很多 一些 怎么 非常 完全 特别 真的 其实 已经 一起 旁边 可以 ' +
      '还是 就是 没有 不是 早点 实话 人们 之后 之前 之间 以上 以下 以及 或者 不过 只是 而是 还有 一样 ' +
      '时间 方面 地方 情况 部分 接下来 这种 那种 其中 以后 以前 现在 今天 明天 昨天 大概 主要 重要'
    )
      .split(/\s+/)
      .filter(Boolean)
  );

  // A term ending right before one of these is a fragment of a longer word:
  // 电影 + 院, 孩子 + 们. Segmentation often splits such compounds, so the suffix
  // is checked as a second guard.
  const COMPOUND_SUFFIXES = new Set([
    ...'院馆店家者员性化们子头长局部所处所院校科室楼路街市县区镇村感度力量率费税价款额数心',
  ]);

  function isMatchableTerm(term) {
    const text = String(term || '').trim();
    if (!/^[\u4e00-\u9fff]{2,4}$/.test(text)) {
      return false;
    }
    return !NON_TERM_TOKENS.has(text);
  }

  function splitMeaning(meaning) {
    const rawMeaning = String(meaning || '').trim();
    if (!rawMeaning) {
      return [];
    }

    return rawMeaning
      .split(/[;；,，、/]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 1);
  }

  function extractAliasTerms(rawAliases) {
    if (!Array.isArray(rawAliases)) {
      return [];
    }

    return rawAliases
      .map((alias) => String(alias || '').trim())
      .filter((alias) => isMatchableTerm(alias));
  }

  // Terms the matcher may look up for this entry. Only curated pairs are used:
  // `meaning` cannot be trusted as a source of replacements because its later
  // senses are unrelated glosses (address: 住址；演说；举止；灵巧) and the build step
  // already derives a noun-vetted head term where one is safe.
  function resolveMatchTerms(aliasTerms) {
    return aliasTerms;
  }

  function normalizeHitCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
      return 0;
    }
    return Math.floor(count);
  }

  function normalizeLastSeen(value) {
    const lastSeen = Number(value);
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) {
      return null;
    }
    return lastSeen;
  }

  function normalizeLearningStatus(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized === 'new') {
      return 'unseen';
    }
    if (normalized === 'learning' || normalized === 'reviewing') {
      return 'seen';
    }
    if (['unseen', 'seen', 'saved', 'mastered', 'skipped'].includes(normalized)) {
      return normalized;
    }
    return 'unseen';
  }

  function normalizeReviewBucket(value) {
    const normalized = String(value || 'today')
      .trim()
      .toLowerCase();
    return REVIEW_BUCKETS.includes(normalized) ? normalized : 'today';
  }

  function getIntervalByBucket(bucket) {
    const normalized = normalizeReviewBucket(bucket);
    if (normalized === 'today') {
      return 1;
    }
    if (normalized === 'soon') {
      return 3;
    }
    return 7;
  }

  function normalizeIntervalDays(value, fallback = DEFAULT_INTERVAL_DAYS) {
    const interval = Number(value);
    if (!Number.isFinite(interval) || interval <= 0) {
      const safeFallback = Number.isFinite(Number(fallback))
        ? Number(fallback)
        : DEFAULT_INTERVAL_DAYS;
      return Math.min(MAX_INTERVAL_DAYS, Math.max(DEFAULT_INTERVAL_DAYS, Math.floor(safeFallback)));
    }
    return Math.min(MAX_INTERVAL_DAYS, Math.max(DEFAULT_INTERVAL_DAYS, Math.round(interval)));
  }

  function normalizeEaseFactor(value, fallback = DEFAULT_EASE_FACTOR) {
    const ease = Number(value);
    if (!Number.isFinite(ease)) {
      const safeFallback = Number.isFinite(Number(fallback))
        ? Number(fallback)
        : DEFAULT_EASE_FACTOR;
      return Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, Number(safeFallback.toFixed(2))));
    }
    return Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, Number(ease.toFixed(2))));
  }

  function normalizeEntry(entry, fallbackLevel) {
    const level = normalizeLevel(entry.level) || fallbackLevel;
    const meaning = String(entry.meaning || entry.translation || '').trim();
    const meaningTerms = splitMeaning(meaning);
    const aliasTerms = extractAliasTerms(entry.aliases);
    const mergedTerms = Array.from(new Set([...meaningTerms, ...aliasTerms]));
    const matchTerms = resolveMatchTerms(aliasTerms);

    return {
      word: String(entry.word || '').trim(),
      meaning,
      translation: meaning,
      level,
      phonetic: String(entry.phonetic || '').trim(),
      partOfSpeech: String(entry.partOfSpeech || '').trim(),
      definition: String(entry.definition || '').trim(),
      aliases: aliasTerms,
      cefrLevel: String(entry.cefrLevel || '')
        .trim()
        .toUpperCase(),
      cefrRank: Number(entry.cefrRank) || 0,
      frequency: Number(entry.frequency) || 0,
      coverageTier:
        String(entry.coverageTier || 'full')
          .trim()
          .toLowerCase() === 'core'
          ? 'core'
          : 'full',
      sourceFlags: Array.isArray(entry.sourceFlags)
        ? entry.sourceFlags.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      altMeanings: Array.isArray(entry.altMeanings)
        ? entry.altMeanings.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      examFrequencyScore: Number(entry.examFrequencyScore) || 0,
      examPriorityScore: Number(entry.examPriorityScore) || 0,
      isPhraseBacked: entry.isPhraseBacked === true,
      phraseCount: Math.max(0, Math.floor(Number(entry.phraseCount) || 0)),
      hitCount: normalizeHitCount(entry.hitCount),
      exposureCount: normalizeHitCount(
        entry.exposureCount != null ? entry.exposureCount : entry.hitCount
      ),
      seenCount: normalizeHitCount(entry.seenCount),
      lookupCount: normalizeHitCount(entry.lookupCount),
      saveCount: normalizeHitCount(entry.saveCount),
      firstSeenAt: normalizeLastSeen(
        entry.firstSeenAt || entry.firstSeen || entry.lastSeenAt || entry.lastSeen
      ),
      lastSeen: normalizeLastSeen(entry.lastSeen),
      lastSeenAt: normalizeLastSeen(entry.lastSeenAt),
      reviewCount: normalizeHitCount(entry.reviewCount),
      lastReviewedAt: normalizeLastSeen(entry.lastReviewedAt),
      masteryScore: Math.max(0, Math.min(100, Math.floor(Number(entry.masteryScore) || 0))),
      learningStatus: normalizeLearningStatus(entry.learningStatus || entry.status || ''),
      nextReviewBucket: normalizeReviewBucket(entry.nextReviewBucket || 'today'),
      intervalDays: normalizeIntervalDays(
        entry.intervalDays,
        getIntervalByBucket(entry.nextReviewBucket)
      ),
      easeFactor: normalizeEaseFactor(entry.easeFactor),
      nextReviewAt: normalizeLastSeen(entry.nextReviewAt),
      meaningTerms: mergedTerms.length ? mergedTerms : [meaning],
      matchTerms,
    };
  }

  function toWordStat(entry) {
    return {
      word: entry.word,
      translation: entry.translation || entry.meaning,
      level: entry.level,
      hitCount: normalizeHitCount(entry.hitCount),
      lastSeen: normalizeLastSeen(entry.lastSeen),
    };
  }

  function normalizeStoredStats(raw) {
    if (!raw || typeof raw !== 'object') {
      return {};
    }

    const normalized = {};
    Object.keys(raw).forEach((key) => {
      const item = raw[key];
      if (!item || typeof item !== 'object') {
        return;
      }

      const normalizedWord = normalizeWordKey(item.word || key);
      if (!normalizedWord) {
        return;
      }

      normalized[normalizedWord] = {
        word: String(item.word || normalizedWord).trim(),
        translation: String(item.translation || item.meaning || '').trim(),
        level: normalizeLevel(item.level),
        hitCount: normalizeHitCount(item.hitCount),
        lastSeen: normalizeLastSeen(item.lastSeen),
      };
    });

    return normalized;
  }

  function toLearningRecord(entry) {
    return {
      word: entry.word,
      translation: entry.translation || entry.meaning,
      level: entry.level,
      sourceLevels:
        Array.isArray(entry.sourceLevels) && entry.sourceLevels.length
          ? entry.sourceLevels.slice()
          : [entry.level],
      exposureCount: normalizeHitCount(
        entry.exposureCount != null ? entry.exposureCount : entry.hitCount
      ),
      hitCount: normalizeHitCount(
        entry.exposureCount != null ? entry.exposureCount : entry.hitCount
      ),
      seenCount: normalizeHitCount(entry.seenCount || entry.hitCount),
      lookupCount: normalizeHitCount(entry.lookupCount),
      saveCount: normalizeHitCount(entry.saveCount),
      firstSeenAt: normalizeLastSeen(
        entry.firstSeenAt || entry.firstSeen || entry.lastSeenAt || entry.lastSeen
      ),
      reviewCount: normalizeHitCount(entry.reviewCount),
      lastSeen: normalizeLastSeen(entry.lastSeen),
      lastSeenAt: normalizeLastSeen(entry.lastSeenAt || entry.lastSeen),
      lastReviewedAt: normalizeLastSeen(entry.lastReviewedAt),
      masteryScore: Math.max(0, Math.min(100, Math.floor(Number(entry.masteryScore) || 0))),
      status: normalizeLearningStatus(entry.learningStatus || 'unseen'),
      nextReviewBucket: normalizeReviewBucket(entry.nextReviewBucket || 'today'),
      intervalDays: normalizeIntervalDays(
        entry.intervalDays,
        getIntervalByBucket(entry.nextReviewBucket)
      ),
      easeFactor: normalizeEaseFactor(entry.easeFactor),
      nextReviewAt: normalizeLastSeen(entry.nextReviewAt),
    };
  }

  function normalizeLearningStats(rawLearning, legacyStats) {
    if (learningState) {
      if (rawLearning && typeof rawLearning === 'object') {
        const normalized = {};
        Object.keys(rawLearning).forEach((key) => {
          const item = rawLearning[key];
          if (!item || typeof item !== 'object') {
            return;
          }
          const word = normalizeWordKey(item.word || key);
          if (!word) {
            return;
          }
          normalized[word] = learningState.normalizeLearningRecord(item, {
            word,
            level: item.level,
          });
        });
        return normalized;
      }

      const migrated = {};
      Object.keys(legacyStats || {}).forEach((key) => {
        migrated[key] = learningState.migrateLegacyStat(legacyStats[key]);
      });
      return migrated;
    }

    return {};
  }

  function getLevelPriority(level) {
    return LEVEL_PRIORITY[normalizeLevel(level)] || 0;
  }

  function getLevelClass(level) {
    const normalized = normalizeLevel(level);
    return LEVEL_CLASS_MAP[normalized] || LEVEL_CLASS_MAP.CET4;
  }

  function getCoverageTierPriority(entry, vocabularyMode) {
    if (vocabularyMode === 'core') {
      return entry && entry.coverageTier === 'core' ? 1000 : 0;
    }
    return entry && entry.coverageTier === 'core' ? 100 : 10;
  }

  // Ranks the entries behind one Chinese term. Frequency used to dominate this
  // sum (raw counts scaled by 1e-5 reach ~8000 while level and exam scores are
  // two-digit), which made the most common polysemous word win every time:
  // 方式→system, 一起→case. CEFR is not scored here either: rewarding harder words
  // at this stage picked 计划→programming and 速度→tempo; target difficulty is
  // applied later against the user's setting.
  function getCandidatePriority(entry, vocabularyMode) {
    if (!entry) {
      return 0;
    }
    return (
      getCoverageTierPriority(entry, vocabularyMode) +
      (Number(entry.examPriorityScore) || 0) * 0.5 +
      getLevelPriority(entry.level) * 10 +
      Math.log10((Number(entry.frequency) || 0) + 1)
    );
  }

  function applyLearningRecordToEntry(entry, record) {
    if (!entry || !record) {
      return entry;
    }

    const exposureCount = normalizeHitCount(
      record.exposureCount != null ? record.exposureCount : record.hitCount
    );

    return {
      ...entry,
      exposureCount,
      hitCount: normalizeHitCount(exposureCount),
      seenCount: normalizeHitCount(record.seenCount || record.exposureCount || record.hitCount),
      lookupCount: normalizeHitCount(record.lookupCount),
      saveCount: normalizeHitCount(record.saveCount),
      firstSeenAt: normalizeLastSeen(
        record.firstSeenAt || record.firstSeen || record.lastSeenAt || record.lastSeen
      ),
      lastSeen: normalizeLastSeen(record.lastSeen),
      lastSeenAt: normalizeLastSeen(record.lastSeenAt || record.lastSeen),
      reviewCount: normalizeHitCount(record.reviewCount),
      lastReviewedAt: normalizeLastSeen(record.lastReviewedAt),
      masteryScore: Math.max(0, Math.min(100, Math.floor(Number(record.masteryScore) || 0))),
      learningStatus: normalizeLearningStatus(record.status || record.learningStatus || 'unseen'),
      nextReviewBucket: normalizeReviewBucket(record.nextReviewBucket || 'today'),
      intervalDays: normalizeIntervalDays(
        record.intervalDays,
        getIntervalByBucket(record.nextReviewBucket)
      ),
      easeFactor: normalizeEaseFactor(record.easeFactor),
      nextReviewAt: normalizeLastSeen(record.nextReviewAt),
      sourceLevels:
        Array.isArray(record.sourceLevels) && record.sourceLevels.length
          ? record.sourceLevels.slice()
          : [entry.level],
    };
  }

  const api = {
    LEVELS,
    LEVEL_CLASS_MAP,
    LEVEL_PRIORITY,
    DEFAULT_ACTIVE_LEVELS,
    REVIEW_BUCKETS,
    DEFAULT_INTERVAL_DAYS,
    DEFAULT_EASE_FACTOR,
    MIN_EASE_FACTOR,
    MAX_EASE_FACTOR,
    MAX_INTERVAL_DAYS,
    ADAPTIVE_FEEDBACK_ACTIONS,
    normalizeLevel,
    normalizeWordKey,
    normalizeActiveLevels,
    splitMeaning,
    extractAliasTerms,
    resolveMatchTerms,
    isMatchableTerm,
    COMPOUND_SUFFIXES,
    normalizeHitCount,
    normalizeLastSeen,
    normalizeLearningStatus,
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
    getCoverageTierPriority,
    getCandidatePriority,
    applyLearningRecordToEntry,
  };

  globalScope.VocabularyPure = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
