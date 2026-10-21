(function (globalScope) {
  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const experienceMetrics =
    globalScope.ExperienceMetrics ||
    (typeof require === 'function' ? require('./experienceMetrics.js') : null);
  const DEFAULT_SETTINGS = sharedSettings
    ? {
        activeLevels: sharedSettings.DEFAULT_SETTINGS.activeLevels.slice(),
        replaceRatio: sharedSettings.DEFAULT_SETTINGS.replaceRatio,
        maxReplaceCount: sharedSettings.DEFAULT_SETTINGS.maxReplaceCount,
        targetCefr: sharedSettings.DEFAULT_SETTINGS.targetCefr,
        vocabularyMode: sharedSettings.DEFAULT_SETTINGS.vocabularyMode,
        examPreference: sharedSettings.DEFAULT_SETTINGS.examPreference,
      }
    : {
        activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
        replaceRatio: 0.2,
        maxReplaceCount: 2,
        targetCefr: 'B2',
        vocabularyMode: 'core',
        examPreference: 'balanced',
      };
  const CEFR_RANK_MAP = {
    A1: 1,
    A2: 2,
    B1: 3,
    B2: 4,
    C1: 5,
    C2: 6,
  };
  const CONTEXT_BLOCK_FLAGS = new Set([
    'proper-noun',
    'proper_noun',
    'person-name',
    'person_name',
    'brand',
    'brand-name',
    'brand_name',
    'url',
    'url-fragment',
    'url_fragment',
    'code',
    'code-fragment',
    'code_fragment',
  ]);
  const CONTEXT_COOLDOWN_BASE_MS = 15 * 60 * 1000;
  const CONTEXT_COOLDOWN_MAX_MS = 24 * 60 * 60 * 1000;
  const RECENT_EXPOSURE_WINDOW_MS = 3 * 60 * 1000;
  const RECENT_EXPOSURE_PENALTY = -80;

  const Utils = globalThis.Utils || (typeof require === 'function' ? require('./utils.js') : null);
  const LRUCache = Utils && Utils.LRUCache;
  const MAX_CACHE_SIZE = 500;

  const escapeHtml =
    (Utils && Utils.escapeHtml) ||
    ((text) =>
      String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;'));

  const WORD_CONTEXT_FEEDBACK_STATE = LRUCache ? new LRUCache(MAX_CACHE_SIZE) : new Map();
  const WORD_RECENT_EXPOSURE_STATE = LRUCache ? new LRUCache(MAX_CACHE_SIZE) : new Map();
  let selectionStateVersion = 0;
  let contextFeedbackVersion = 0;

  function nextStateVersion(version) {
    const nextVersion = Number(version) + 1;
    return Number.isSafeInteger(nextVersion) ? nextVersion : 1;
  }

  function bumpSelectionStateVersion() {
    selectionStateVersion = nextStateVersion(selectionStateVersion);
  }

  function bumpContextFeedbackVersion() {
    contextFeedbackVersion = nextStateVersion(contextFeedbackVersion);
    bumpSelectionStateVersion();
  }

  function recordExperienceMetric(eventType, options = {}) {
    if (!experienceMetrics || typeof experienceMetrics.recordEvent !== 'function') {
      return;
    }

    try {
      const result = experienceMetrics.recordEvent(eventType, options);
      if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (_error) {
      // Ignore metrics failures; translator should remain synchronous.
    }
  }

  function normalizeRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) {
      return DEFAULT_SETTINGS.replaceRatio;
    }

    return Math.min(0.3, Math.max(0.1, Number(ratio.toFixed(2))));
  }

  function normalizeMaxReplaceCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) {
      return DEFAULT_SETTINGS.maxReplaceCount;
    }

    return Math.min(5, Math.max(1, Math.floor(count)));
  }

  function normalizeActiveLevels(activeLevels) {
    if (sharedSettings) {
      return sharedSettings.normalizeActiveLevels(activeLevels);
    }

    if (
      globalScope.VocabularyModule &&
      typeof globalScope.VocabularyModule.normalizeActiveLevels === 'function'
    ) {
      return globalScope.VocabularyModule.normalizeActiveLevels(activeLevels);
    }

    const fallbackLevels = DEFAULT_SETTINGS.activeLevels;
    const allowedLevels = new Set(fallbackLevels);
    if (!Array.isArray(activeLevels)) {
      return fallbackLevels.slice();
    }

    const normalized = activeLevels
      .map((level) =>
        String(level || '')
          .trim()
          .toUpperCase()
      )
      .filter((level) => Boolean(level) && allowedLevels.has(level));

    return normalized.length ? Array.from(new Set(normalized)) : fallbackLevels.slice();
  }

  function normalizeTargetCefr(targetCefr) {
    if (sharedSettings) {
      return sharedSettings.normalizeTargetCefr(targetCefr);
    }

    const normalized = String(targetCefr || '')
      .trim()
      .toUpperCase();
    if (CEFR_RANK_MAP[normalized]) {
      return normalized;
    }
    return DEFAULT_SETTINGS.targetCefr;
  }

  function normalizeSettings(settings) {
    const source = settings || {};
    return {
      replaceRatio: normalizeRatio(source.replaceRatio),
      maxReplaceCount: normalizeMaxReplaceCount(source.maxReplaceCount),
      activeLevels: normalizeActiveLevels(source.activeLevels),
      targetCefr: normalizeTargetCefr(source.targetCefr),
      vocabularyMode: sharedSettings
        ? sharedSettings.normalizeVocabularyMode(source.vocabularyMode)
        : DEFAULT_SETTINGS.vocabularyMode,
      examPreference: sharedSettings
        ? sharedSettings.normalizeExamPreference(source.examPreference)
        : DEFAULT_SETTINGS.examPreference,
    };
  }

  function createSettingsFingerprint(settings) {
    const normalized = normalizeSettings(settings);
    const sortedLevels = normalized.activeLevels.slice().sort();
    return `${normalized.replaceRatio.toFixed(2)}|${normalized.maxReplaceCount}|${normalized.targetCefr}|${normalized.vocabularyMode}|${normalized.examPreference}|${sortedLevels.join(',')}`;
  }

  function getLevelPriority(level) {
    if (
      globalScope.VocabularyModule &&
      typeof globalScope.VocabularyModule.getLevelPriority === 'function'
    ) {
      return globalScope.VocabularyModule.getLevelPriority(level);
    }

    const fallback = {
      CET4: 1,
      CET6: 2,
      KAOYAN: 3,
      IELTS: 4,
      TOEFL: 5,
    };

    return (
      fallback[
        String(level || '')
          .trim()
          .toUpperCase()
      ] || 0
    );
  }

  function hasOverlap(candidate, selected) {
    return selected.some((item) => !(candidate.end <= item.start || candidate.start >= item.end));
  }

  function normalizeWordKey(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    return Math.floor(timestamp);
  }

  function normalizeSourceFlags(sourceFlags) {
    if (!Array.isArray(sourceFlags)) {
      return [];
    }

    return sourceFlags
      .map((flag) =>
        String(flag || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);
  }

  function getCandidateContextToken(sourceText, candidate) {
    if (!sourceText || !candidate) {
      return '';
    }

    const start = Math.max(0, Math.floor(Number(candidate.start) || 0));
    const end = Math.max(start, Math.floor(Number(candidate.end) || start));
    const maxLength = sourceText.length;
    if (start >= maxLength) {
      return '';
    }

    let left = start;
    let right = Math.min(maxLength, end);
    while (left > 0 && !/\s/.test(sourceText[left - 1])) {
      left -= 1;
    }
    while (right < maxLength && !/\s/.test(sourceText[right])) {
      right += 1;
    }
    return sourceText.slice(left, right);
  }

  function isLikelyUrlToken(token) {
    const source = String(token || '').trim();
    if (!source) {
      return false;
    }
    if (/^(https?:\/\/|www\.)/i.test(source)) {
      return true;
    }
    return /[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(source);
  }

  function isLikelyCodeToken(token) {
    const source = String(token || '').trim();
    if (!source) {
      return false;
    }

    const hasCodePunctuation =
      /[`{}[\]<>_=;:$]/.test(source) || source.includes('=>') || source.includes('::');
    const hasLatin = /[a-z]/i.test(source);
    return hasCodePunctuation && hasLatin;
  }

  function shouldBlockByContextRule(candidate, sourceText) {
    const flags = normalizeSourceFlags(candidate && candidate.sourceFlags);
    if (flags.some((flag) => CONTEXT_BLOCK_FLAGS.has(flag))) {
      return true;
    }

    const token = getCandidateContextToken(sourceText, candidate);
    if (!token) {
      return false;
    }
    return isLikelyUrlToken(token) || isLikelyCodeToken(token);
  }

  function resolveSelectionContext(sourceTextOrContext) {
    if (typeof sourceTextOrContext === 'string') {
      return {
        sourceText: sourceTextOrContext,
        now: Date.now(),
      };
    }

    if (sourceTextOrContext && typeof sourceTextOrContext === 'object') {
      return {
        sourceText: String(sourceTextOrContext.sourceText || ''),
        now: normalizeTimestamp(sourceTextOrContext.now) || Date.now(),
      };
    }

    return {
      sourceText: '',
      now: Date.now(),
    };
  }

  function clearExpiredContextCooldown(now = Date.now()) {
    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    let removed = false;
    WORD_CONTEXT_FEEDBACK_STATE.forEach((state, key) => {
      const cooldownUntil = normalizeTimestamp(state && state.cooldownUntil);
      if (cooldownUntil != null && cooldownUntil <= nowTimestamp) {
        WORD_CONTEXT_FEEDBACK_STATE.delete(key);
        removed = true;
      }
    });
    if (removed) {
      bumpContextFeedbackVersion();
    }
  }

  function getContextCooldownPenalty(candidate, now = Date.now()) {
    const wordKey = normalizeWordKey(candidate && candidate.word);
    if (!wordKey) {
      return 0;
    }

    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    const state = WORD_CONTEXT_FEEDBACK_STATE.get(wordKey);
    if (!state) {
      return 0;
    }

    const cooldownUntil = normalizeTimestamp(state.cooldownUntil);
    if (cooldownUntil == null || cooldownUntil <= nowTimestamp) {
      return 0;
    }
    return -200;
  }

  function clearExpiredRecentExposure(now = Date.now()) {
    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    let removed = false;
    WORD_RECENT_EXPOSURE_STATE.forEach((state, key) => {
      const lastExposedAt = normalizeTimestamp(state && state.lastExposedAt);
      if (lastExposedAt == null || nowTimestamp - lastExposedAt > RECENT_EXPOSURE_WINDOW_MS) {
        WORD_RECENT_EXPOSURE_STATE.delete(key);
        removed = true;
      }
    });
    if (removed) {
      bumpSelectionStateVersion();
    }
  }

  function getRecentExposurePenalty(candidate, now = Date.now()) {
    const wordKey = normalizeWordKey(candidate && candidate.word);
    if (!wordKey) {
      return 0;
    }

    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    const state = WORD_RECENT_EXPOSURE_STATE.get(wordKey);
    if (!state) {
      return 0;
    }

    const lastExposedAt = normalizeTimestamp(state.lastExposedAt);
    if (lastExposedAt == null || nowTimestamp - lastExposedAt > RECENT_EXPOSURE_WINDOW_MS) {
      return 0;
    }

    const exposureCount = Math.max(1, Number(state.count) || 1);
    return RECENT_EXPOSURE_PENALTY * Math.min(3, exposureCount);
  }

  function calculateReplacementCount(totalMatches, settings) {
    if (!totalMatches) {
      return 0;
    }

    const byRatio = Math.max(1, Math.ceil(totalMatches * settings.replaceRatio));
    return Math.min(settings.maxReplaceCount, byRatio);
  }

  function getCandidateCefrRank(candidate) {
    const directRank = Number(candidate && candidate.cefrRank);
    if (Number.isInteger(directRank) && directRank >= 1 && directRank <= 6) {
      return directRank;
    }

    const levelText = String((candidate && candidate.cefrLevel) || '')
      .trim()
      .toUpperCase();
    return CEFR_RANK_MAP[levelText] || 0;
  }

  function getCefrPreferenceScore(candidate, targetCefr) {
    const targetRank =
      CEFR_RANK_MAP[
        String(targetCefr || '')
          .trim()
          .toUpperCase()
      ] || 0;
    if (!targetRank) {
      return 0;
    }

    const candidateRank = getCandidateCefrRank(candidate);
    if (!candidateRank) {
      return -100;
    }

    return 10 - Math.abs(candidateRank - targetRank);
  }

  function getFrequencyScore(candidate) {
    const frequency = Number(candidate && candidate.frequency);
    if (!Number.isFinite(frequency) || frequency < 0) {
      return 0;
    }
    return frequency;
  }

  function getCoverageTierScore(candidate, vocabularyMode) {
    const tier = String((candidate && candidate.coverageTier) || '')
      .trim()
      .toLowerCase();
    if (vocabularyMode === 'core') {
      return tier === 'core' ? 1000 : 0;
    }
    if (tier === 'core') {
      return 100;
    }
    if (tier === 'full') {
      return 10;
    }
    return 0;
  }

  function getExamPriorityScore(candidate, examPreference) {
    const basePriority = Number(candidate && candidate.examPriorityScore);
    const baseFrequency = Number(candidate && candidate.examFrequencyScore);
    const priority = Number.isFinite(basePriority) ? basePriority : 0;
    const frequency = Number.isFinite(baseFrequency) ? baseFrequency : 0;
    return priority + (examPreference === 'exam-first' ? frequency * 0.2 : frequency * 0.05);
  }

  function getLearningStatusScore(candidate) {
    const status = String((candidate && candidate.learningStatus) || '')
      .trim()
      .toLowerCase();
    if (status === 'saved') {
      return 75;
    }
    if (status === 'seen' || status === 'learning') {
      return 60;
    }
    if (status === 'unseen' || status === 'new') {
      return 45;
    }
    if (status === 'skipped') {
      return -20;
    }
    if (status === 'mastered') {
      return -30;
    }
    return 0;
  }

  function getPhrasePriorityScore(candidate) {
    const isPhraseBacked = candidate && candidate.isPhraseBacked === true;
    const phraseCount = Number(candidate && candidate.phraseCount);
    const normalizedCount = Number.isFinite(phraseCount) ? Math.max(0, phraseCount) : 0;
    return (isPhraseBacked ? 40 : 0) + Math.min(30, normalizedCount * 3);
  }

  function compareMatches(a, b, normalizedSettings, selectionContext) {
    const coverageDiff =
      getCoverageTierScore(b, normalizedSettings.vocabularyMode) -
      getCoverageTierScore(a, normalizedSettings.vocabularyMode);
    if (coverageDiff !== 0) return coverageDiff;

    const examDiff =
      getExamPriorityScore(b, normalizedSettings.examPreference) -
      getExamPriorityScore(a, normalizedSettings.examPreference);
    if (examDiff !== 0) return examDiff;

    const cooldownDiff =
      getContextCooldownPenalty(b, selectionContext.now) -
      getContextCooldownPenalty(a, selectionContext.now);
    if (cooldownDiff !== 0) return cooldownDiff;

    const exposureDiff =
      getRecentExposurePenalty(b, selectionContext.now) -
      getRecentExposurePenalty(a, selectionContext.now);
    if (exposureDiff !== 0) return exposureDiff;

    const learningDiff = getLearningStatusScore(b) - getLearningStatusScore(a);
    if (learningDiff !== 0) return learningDiff;

    const phraseDiff = getPhrasePriorityScore(b) - getPhrasePriorityScore(a);
    if (phraseDiff !== 0) return phraseDiff;

    const priorityDiff = getLevelPriority(b.level) - getLevelPriority(a.level);
    if (priorityDiff !== 0) return priorityDiff;

    const cefrDiff =
      getCefrPreferenceScore(b, normalizedSettings.targetCefr) -
      getCefrPreferenceScore(a, normalizedSettings.targetCefr);
    if (cefrDiff !== 0) return cefrDiff;

    const freqDiff = getFrequencyScore(b) - getFrequencyScore(a);
    if (freqDiff !== 0) return freqDiff;

    const lengthDiff = b.end - b.start - (a.end - a.start);
    return lengthDiff !== 0 ? lengthDiff : a.start - b.start;
  }

  function selectMatches(matches, settings, sourceTextOrContext) {
    if (!Array.isArray(matches) || matches.length === 0) {
      return [];
    }

    const normalizedSettings = normalizeSettings(settings);
    const selectionContext = resolveSelectionContext(sourceTextOrContext);
    clearExpiredContextCooldown(selectionContext.now);
    clearExpiredRecentExposure(selectionContext.now);

    const filteredCandidates = matches.filter((candidate) => {
      return !shouldBlockByContextRule(candidate, selectionContext.sourceText);
    });
    if (filteredCandidates.length === 0) {
      return [];
    }

    const targetCount = calculateReplacementCount(filteredCandidates.length, normalizedSettings);
    const sortedCandidates = filteredCandidates
      .slice()
      .sort((a, b) => compareMatches(a, b, normalizedSettings, selectionContext));

    const selected = [];
    const selectedWordKeys = new Set();

    function trySelectCandidate(candidate, avoidDuplicateWord) {
      if (hasOverlap(candidate, selected)) {
        return false;
      }

      const wordKey = normalizeWordKey(candidate.word);
      if (avoidDuplicateWord && wordKey && selectedWordKeys.has(wordKey)) {
        return false;
      }

      selected.push(candidate);
      if (wordKey) {
        selectedWordKeys.add(wordKey);
      }

      return selected.length >= targetCount;
    }

    sortedCandidates.some((candidate) => trySelectCandidate(candidate, true));

    if (selected.length < targetCount) {
      sortedCandidates.some((candidate) => {
        if (selected.includes(candidate)) {
          return false;
        }

        return trySelectCandidate(candidate, false);
      });
    }

    return selected;
  }

  function buildTokens(text, matches) {
    const source = String(text || '');
    if (!source) {
      return [];
    }

    if (!Array.isArray(matches) || matches.length === 0) {
      return [{ type: 'text', text: source }];
    }

    const tokens = [];
    const orderedMatches = matches.slice().sort((a, b) => a.start - b.start);

    let cursor = 0;
    orderedMatches.forEach((match) => {
      if (cursor < match.start) {
        tokens.push({
          type: 'text',
          text: source.slice(cursor, match.start),
        });
      }

      tokens.push({
        type: 'word',
        text: match.word,
        word: match.word,
        level: match.level,
        learningStatus: match.learningStatus,
        cefrLevel: match.cefrLevel,
        cefrRank: match.cefrRank,
        frequency: match.frequency,
        meaning: match.meaning,
        partOfSpeech: match.partOfSpeech,
        definition: match.definition,
        phonetic: match.phonetic,
        sourceText: source.slice(match.start, match.end),
        coverageTier: match.coverageTier,
        sourceFlags: Array.isArray(match.sourceFlags) ? match.sourceFlags.slice() : [],
        isPhraseBacked: match.isPhraseBacked === true,
        phraseCount: match.phraseCount,
      });

      cursor = match.end;
    });

    if (cursor < source.length) {
      tokens.push({
        type: 'text',
        text: source.slice(cursor),
      });
    }

    return tokens;
  }

  function getWordDisplayText(token) {
    if (!token || typeof token !== 'object') {
      return '';
    }

    const word = String(token.word || '').trim();
    if (!word) {
      return '';
    }

    const originalText = String(token.sourceText || token.meaning || '').trim();
    if (!originalText) {
      return word;
    }

    return `${word}（${originalText}）`;
  }

  function buildMixedText(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return '';
    }

    return tokens
      .map((token) => {
        if (token.type === 'word') {
          return getWordDisplayText(token);
        }
        return token.text || '';
      })
      .join('');
  }

  function reportRenderedExposure(word, options = {}) {
    const wordKey = normalizeWordKey(word);
    if (!wordKey) {
      return null;
    }

    const now = normalizeTimestamp(options.now) || Date.now();
    const previous = WORD_RECENT_EXPOSURE_STATE.get(wordKey) || {
      count: 0,
      lastExposedAt: null,
    };
    const nextState = {
      count: Math.min(12, Math.max(0, Number(previous.count) || 0) + 1),
      lastExposedAt: now,
    };
    WORD_RECENT_EXPOSURE_STATE.set(wordKey, nextState);
    bumpSelectionStateVersion();

    return {
      word: wordKey,
      ...nextState,
      inRecentWindow: true,
    };
  }

  function getWordExposureState(word, now = Date.now()) {
    const wordKey = normalizeWordKey(word);
    if (!wordKey) {
      return {
        word: '',
        count: 0,
        lastExposedAt: null,
        inRecentWindow: false,
      };
    }

    clearExpiredRecentExposure(now);
    const state = WORD_RECENT_EXPOSURE_STATE.get(wordKey) || {
      count: 0,
      lastExposedAt: null,
    };
    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    const lastExposedAt = normalizeTimestamp(state.lastExposedAt);

    return {
      word: wordKey,
      count: Number(state.count) || 0,
      lastExposedAt,
      inRecentWindow:
        lastExposedAt != null && nowTimestamp - lastExposedAt <= RECENT_EXPOSURE_WINDOW_MS,
    };
  }

  function reportContextMisreplace(word, options = {}) {
    const wordKey = normalizeWordKey(word);
    if (!wordKey) {
      return null;
    }

    const now = normalizeTimestamp(options.now) || Date.now();
    const severity = String(options.severity || 'normal')
      .trim()
      .toLowerCase();
    const increment = severity === 'high' ? 2 : 1;
    const previous = WORD_CONTEXT_FEEDBACK_STATE.get(wordKey) || {
      count: 0,
      cooldownUntil: null,
      lastReportedAt: null,
    };
    const nextCount = Math.min(12, Math.max(0, Number(previous.count) || 0) + increment);

    let cooldownUntil = normalizeTimestamp(previous.cooldownUntil);
    if (nextCount >= 3) {
      const cooldownLevel = nextCount - 2;
      const duration = Math.min(CONTEXT_COOLDOWN_MAX_MS, CONTEXT_COOLDOWN_BASE_MS * cooldownLevel);
      cooldownUntil = now + duration;
    }

    const nextState = {
      count: nextCount,
      cooldownUntil,
      lastReportedAt: now,
    };
    WORD_CONTEXT_FEEDBACK_STATE.set(wordKey, nextState);
    bumpContextFeedbackVersion();
    recordExperienceMetric('context-misreplace', {
      severity,
      now,
    });

    return {
      word: wordKey,
      ...nextState,
      inCooldown: cooldownUntil != null && cooldownUntil > now,
    };
  }

  function getWordCooldownState(word, now = Date.now()) {
    const wordKey = normalizeWordKey(word);
    if (!wordKey) {
      return {
        word: '',
        count: 0,
        cooldownUntil: null,
        lastReportedAt: null,
        inCooldown: false,
      };
    }

    clearExpiredContextCooldown(now);
    const state = WORD_CONTEXT_FEEDBACK_STATE.get(wordKey) || {
      count: 0,
      cooldownUntil: null,
      lastReportedAt: null,
    };
    const nowTimestamp = normalizeTimestamp(now) || Date.now();
    const cooldownUntil = normalizeTimestamp(state.cooldownUntil);
    return {
      word: wordKey,
      count: Number(state.count) || 0,
      cooldownUntil,
      lastReportedAt: normalizeTimestamp(state.lastReportedAt),
      inCooldown: cooldownUntil != null && cooldownUntil > nowTimestamp,
    };
  }

  function resetContextFeedbackForTest() {
    WORD_CONTEXT_FEEDBACK_STATE.clear();
    WORD_RECENT_EXPOSURE_STATE.clear();
    bumpContextFeedbackVersion();
  }

  function getSelectionStateVersion(now = Date.now()) {
    clearExpiredContextCooldown(now);
    clearExpiredRecentExposure(now);
    return selectionStateVersion;
  }

  function getContextFeedbackVersion(now = Date.now()) {
    clearExpiredContextCooldown(now);
    return contextFeedbackVersion;
  }

  async function processSubtitle(text, settings) {
    const sourceText = String(text || '').trim();
    if (!sourceText) {
      return {
        tokens: [],
        mixedText: '',
        replacements: [],
        html: '',
      };
    }

    if (!globalScope.VocabularyModule) {
      throw new Error('VocabularyModule is required');
    }

    await globalScope.VocabularyModule.loadVocabulary();

    const normalizedSettings = normalizeSettings(settings);
    const matches = globalScope.VocabularyModule.findMatchesInText(
      sourceText,
      normalizedSettings.activeLevels,
      normalizedSettings
    );
    const selected = selectMatches(matches, normalizedSettings, sourceText);

    const tokens = buildTokens(sourceText, selected);
    const mixedText = buildMixedText(tokens);

    const replacements = selected.map((item) => ({
      word: item.word,
      meaning: item.meaning,
      level: item.level,
      cefrLevel: item.cefrLevel,
      cefrRank: item.cefrRank,
      frequency: item.frequency,
      partOfSpeech: item.partOfSpeech,
      definition: item.definition,
      phonetic: item.phonetic,
      coverageTier: item.coverageTier,
      sourceFlags: Array.isArray(item.sourceFlags) ? item.sourceFlags.slice() : [],
      isPhraseBacked: item.isPhraseBacked === true,
      phraseCount: item.phraseCount,
    }));

    return {
      tokens,
      mixedText,
      replacements,
      html: escapeHtml(mixedText),
    };
  }

  const api = {
    normalizeRatio,
    normalizeMaxReplaceCount,
    normalizeSettings,
    normalizeTargetCefr,
    createSettingsFingerprint,
    selectMatches,
    buildTokens,
    getWordDisplayText,
    buildMixedText,
    reportRenderedExposure,
    getWordExposureState,
    reportContextMisreplace,
    getWordCooldownState,
    getSelectionStateVersion,
    getContextFeedbackVersion,
    __resetContextFeedbackForTest: resetContextFeedbackForTest,
    processSubtitle,
  };

  globalScope.SubtitleTranslator = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
