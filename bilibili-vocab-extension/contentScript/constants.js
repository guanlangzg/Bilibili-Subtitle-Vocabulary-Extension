(function () {
  // Legacy runtime keys retained for backward compatibility across extension components.
  const CONTENT_SCRIPT_INSTANCE_KEY = '__BILI_VOCAB_CONTENT_SCRIPT_INSTANCE__';

  const config =
    globalThis.Config || (typeof require === 'function' ? require('../config.js') : null);

  const DEFAULT_SETTINGS =
    config && config.DEFAULT_SETTINGS
      ? { ...config.DEFAULT_SETTINGS }
      : {
          enabled: true,
          schemaVersion: 2,
          reviewDanmakuEnabled: false,
          reviewDanmakuSpeed: 'normal',
          reviewDanmakuDensity: 'normal',
          webPageEnabled: false,
          domainRules: {},
          activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
          replaceRatio: 0.2,
          maxReplaceCount: 2,
          targetCefr: 'B2',
          vocabularyMode: 'core',
          examPreference: 'balanced',
          bilingualMode: 'default',
          themeMode: 'auto',
        };

  const PROCESS_DELAY_MS = 120;
  const MUTATION_OBSERVER_THROTTLE_MS = 500;
  const TIMELINE_POLL_MS = 300;
  const TRANSLATION_CACHE_LIMIT = 200;
  const WEB_TEXT_PROCESS_INTERVAL = 1000;

  const LEGACY_WEB_TEXT_PIPELINE_FLAG = '__BILI_VOCAB_ENABLE_LEGACY_WEB_TEXT_PIPELINE__';
  const DEBUG_LOG_FLAG = '__BILI_VOCAB_DEBUG_LOGS__';

  const VIDEO_SITE_HOSTS = [
    'bilibili.com',
    'youtube.com',
    'v.qq.com',
    'iqiyi.com',
    'netflix.com',
    'youku.com',
  ];
  const DEFAULT_OVERLAY_HOSTS = ['www.bilibili.com', 'www.youtube.com'];

  // Legacy data attribute names retained for backward compatibility with rendered markup.
  const HIT_SIGNATURE_DATA_KEY = 'biliVocabHitSignature';
  const RENDER_SIGNATURE_DATA_KEY = 'biliVocabRenderSignature';

  // Legacy message namespaces retained for backward compatibility across extension components.
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_READ = 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ';
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE =
    'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE';
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE =
    'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE';
  const OVERLAY_SUBTITLE_NAVIGATION_BRIDGE_KEY = 'BiliVocabOverlaySubtitleNavigationBridge';

  const sharedSettings =
    globalThis.SharedSettings ||
    (typeof require === 'function' ? require('../sharedSettings.js') : null);

  const TRANSLATION_SETTINGS_KEYS =
    sharedSettings && Array.isArray(sharedSettings.SETTINGS_STORAGE_KEYS)
      ? sharedSettings.SETTINGS_STORAGE_KEYS.filter(
          (key) =>
            key !== 'reviewDanmakuEnabled' &&
            key !== 'reviewDanmakuSpeed' &&
            key !== 'reviewDanmakuDensity'
        )
      : [
          'enabled',
          'activeLevels',
          'replaceRatio',
          'maxReplaceCount',
          'targetCefr',
          'vocabularyMode',
          'examPreference',
          'webPageEnabled',
          'domainRules',
          'schemaVersion',
        ];

  const RUNTIME_SETTINGS_KEYS = [
    ...TRANSLATION_SETTINGS_KEYS,
    'reviewDanmakuEnabled',
    'reviewDanmakuSpeed',
    'reviewDanmakuDensity',
  ];

  const SETTINGS_STORAGE_KEY_V3 =
    sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
      ? sharedSettings.SETTINGS_STORAGE_KEY_V3
      : 'bili_vocab_settings_v3';

  const EFFECTIVE_DEFAULTS = sharedSettings
    ? { ...DEFAULT_SETTINGS, ...(sharedSettings.DEFAULT_SETTINGS || {}) }
    : { ...DEFAULT_SETTINGS };

  const LEARNING_WORD_STATS_STORAGE_KEY = globalThis.LearningState
    ? globalThis.LearningState.STORAGE_KEYS.WORD_STATS_V2
    : 'bili_vocab_word_stats_v2';
  const REVIEW_QUEUE_STORAGE_KEY = globalThis.LearningState
    ? globalThis.LearningState.STORAGE_KEYS.REVIEW_QUEUE
    : 'bili_vocab_review_queue_v1';
  const LEARNING_SUMMARY_STORAGE_KEY = globalThis.LearningState
    ? globalThis.LearningState.STORAGE_KEYS.LEARNING_SUMMARY
    : 'bili_vocab_learning_summary_v1';

  function hasMethod(obj, method) {
    return obj && typeof obj[method] === 'function';
  }

  function isVideoSiteHost(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    return VIDEO_SITE_HOSTS.some((site) => normalized === site || normalized.endsWith(`.${site}`));
  }

  function shouldLoadOverlayModuleForHost(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    if (!normalized) {
      return true;
    }
    return DEFAULT_OVERLAY_HOSTS.includes(normalized);
  }

  function shouldEnableTimelinePolling() {
    const doc = globalThis.document;
    return Boolean(doc && typeof doc.querySelector === 'function' && doc.querySelector('video'));
  }

  function shouldLogDebug() {
    return globalThis[DEBUG_LOG_FLAG] === true;
  }

  function logDebug(...args) {
    if (shouldLogDebug()) {
      console.debug(...args);
    }
  }

  function normalizeReviewDanmakuSpeed(speed) {
    if (sharedSettings) {
      return sharedSettings.normalizeReviewDanmakuSpeed(speed);
    }
    const normalized = String(speed || EFFECTIVE_DEFAULTS.reviewDanmakuSpeed)
      .trim()
      .toLowerCase();
    return ['slow', 'normal', 'fast'].includes(normalized)
      ? normalized
      : EFFECTIVE_DEFAULTS.reviewDanmakuSpeed;
  }

  function normalizeReviewDanmakuDensity(density) {
    if (sharedSettings && typeof sharedSettings.normalizeReviewDanmakuDensity === 'function') {
      return sharedSettings.normalizeReviewDanmakuDensity(density);
    }
    const normalized = String(density || EFFECTIVE_DEFAULTS.reviewDanmakuDensity)
      .trim()
      .toLowerCase();
    return ['sparse', 'normal', 'dense'].includes(normalized)
      ? normalized
      : EFFECTIVE_DEFAULTS.reviewDanmakuDensity;
  }

  const normalizeText =
    (globalThis.Utils && globalThis.Utils.normalizeText) ||
    ((text) =>
      String(text || '')
        .replace(/\s+/g, ' ')
        .trim());

  const logError =
    (globalThis.Utils && globalThis.Utils.logError) ||
    ((context, error) => console.error(`[BiliVocab] ${context}:`, error));

  const api = {
    CONTENT_SCRIPT_INSTANCE_KEY,
    DEFAULT_SETTINGS,
    PROCESS_DELAY_MS,
    MUTATION_OBSERVER_THROTTLE_MS,
    TIMELINE_POLL_MS,
    TRANSLATION_CACHE_LIMIT,
    WEB_TEXT_PROCESS_INTERVAL,
    LEGACY_WEB_TEXT_PIPELINE_FLAG,
    DEBUG_LOG_FLAG,
    VIDEO_SITE_HOSTS,
    DEFAULT_OVERLAY_HOSTS,
    HIT_SIGNATURE_DATA_KEY,
    RENDER_SIGNATURE_DATA_KEY,
    ACTIVE_TAB_SUBTITLE_NAVIGATION_READ,
    ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE,
    ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE,
    OVERLAY_SUBTITLE_NAVIGATION_BRIDGE_KEY,
    sharedSettings,
    TRANSLATION_SETTINGS_KEYS,
    RUNTIME_SETTINGS_KEYS,
    SETTINGS_STORAGE_KEY_V3,
    EFFECTIVE_DEFAULTS,
    LEARNING_WORD_STATS_STORAGE_KEY,
    REVIEW_QUEUE_STORAGE_KEY,
    LEARNING_SUMMARY_STORAGE_KEY,
    hasMethod,
    isVideoSiteHost,
    shouldLoadOverlayModuleForHost,
    shouldEnableTimelinePolling,
    shouldLogDebug,
    logDebug,
    normalizeReviewDanmakuSpeed,
    normalizeReviewDanmakuDensity,
    normalizeText,
    logError,
  };

  globalThis.BiliVocabContentConstants = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
