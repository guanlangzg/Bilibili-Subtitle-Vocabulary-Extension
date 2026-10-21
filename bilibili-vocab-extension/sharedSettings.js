(function (globalScope) {
  const SCHEMA_VERSION = 2;
  const LEVELS = Array.isArray(globalScope.Config && globalScope.Config.LEVELS)
    ? globalScope.Config.LEVELS.slice()
    : ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
  const CEFR_LEVELS = Array.isArray(globalScope.Config && globalScope.Config.CEFR_LEVELS)
    ? globalScope.Config.CEFR_LEVELS.slice()
    : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const REVIEW_SPEEDS = Array.isArray(globalScope.Config && globalScope.Config.REVIEW_SPEEDS)
    ? globalScope.Config.REVIEW_SPEEDS.slice()
    : ['slow', 'normal', 'fast'];
  const REVIEW_DENSITIES = Array.isArray(globalScope.Config && globalScope.Config.REVIEW_DENSITIES)
    ? globalScope.Config.REVIEW_DENSITIES.slice()
    : ['sparse', 'normal', 'dense'];
  const VOCABULARY_MODES = Array.isArray(globalScope.Config && globalScope.Config.VOCABULARY_MODES)
    ? globalScope.Config.VOCABULARY_MODES.slice()
    : ['core', 'full'];
  const EXAM_PREFERENCES = Array.isArray(globalScope.Config && globalScope.Config.EXAM_PREFERENCES)
    ? globalScope.Config.EXAM_PREFERENCES.slice()
    : ['balanced', 'exam-first'];
  const BILINGUAL_MODES = ['default', 'bilingual', 'english-only'];
  const THEME_MODES = ['auto', 'light', 'dark'];

  const DEFAULT_SETTINGS =
    globalScope.Config && globalScope.Config.DEFAULT_SETTINGS
      ? { ...globalScope.Config.DEFAULT_SETTINGS }
      : {
          enabled: true,
          schemaVersion: SCHEMA_VERSION,
          reviewDanmakuEnabled: false,
          reviewDanmakuSpeed: 'normal',
          reviewDanmakuDensity: 'normal',
          vocabularyMode: 'core',
          examPreference: 'balanced',
          webPageEnabled: false,
          domainRules: {},
          activeLevels: LEVELS.slice(),
          replaceRatio: 0.2,
          maxReplaceCount: 2,
          targetCefr: 'B2',
          bilingualMode: 'default',
          themeMode: 'auto',
        };

  const SETTINGS_STORAGE_KEYS = Object.freeze([
    'enabled',
    'webPageEnabled',
    'reviewDanmakuEnabled',
    'reviewDanmakuSpeed',
    'reviewDanmakuDensity',
    'vocabularyMode',
    'examPreference',
    'activeLevels',
    'replaceRatio',
    'maxReplaceCount',
    'targetCefr',
    'bilingualMode',
    'themeMode',
    'domainRules',
    'schemaVersion',
  ]);

  const SCHEMA_VERSION_V3 = 3;
  // Legacy storage key retained for backward compatibility with existing installs.
  const SETTINGS_STORAGE_KEY_V3 = 'bili_vocab_settings_v3';
  const BUILTIN_PROFILE_IDS = Object.freeze(['gentle', 'balanced', 'intensive']);
  const MAX_CUSTOM_PROFILES = 5;
  const OVERLAY_BOUNDS = Object.freeze({
    minWidth: 320,
    maxWidth: 560,
    minHeight: 360,
    maxHeight: 760,
    minOffsetRight: 12,
    maxOffsetRight: 360,
    minOffsetBottom: 24,
    maxOffsetBottom: 240,
  });
  const OVERLAY_DEFAULTS = Object.freeze({
    hidden: false,
    collapsed: false,
    width: 420,
    height: 640,
    offsetRight: 24,
    offsetBottom: 96,
  });

  const SCENE_PRESETS = {
    light: {
      replaceRatio: 0.15,
      maxReplaceCount: 1,
      reviewDanmakuSpeed: 'slow',
      reviewDanmakuDensity: 'sparse',
    },
    balanced: {
      replaceRatio: 0.2,
      maxReplaceCount: 2,
      reviewDanmakuSpeed: 'normal',
      reviewDanmakuDensity: 'normal',
    },
    intensive: {
      replaceRatio: 0.3,
      maxReplaceCount: 4,
      reviewDanmakuSpeed: 'fast',
      reviewDanmakuDensity: 'dense',
    },
  };

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  function parseFiniteNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function makeProfileId(input) {
    const raw = String(input || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 32);
    return raw || `profile-${Date.now()}`;
  }

  function normalizeTargetCefr(value) {
    const targetCefr = String(value || DEFAULT_SETTINGS.targetCefr)
      .trim()
      .toUpperCase();
    return CEFR_LEVELS.includes(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr;
  }

  function normalizeReviewDanmakuSpeed(value) {
    const reviewDanmakuSpeed = String(value || DEFAULT_SETTINGS.reviewDanmakuSpeed)
      .trim()
      .toLowerCase();
    return REVIEW_SPEEDS.includes(reviewDanmakuSpeed)
      ? reviewDanmakuSpeed
      : DEFAULT_SETTINGS.reviewDanmakuSpeed;
  }

  function normalizeReviewDanmakuDensity(value) {
    const reviewDanmakuDensity = String(value || DEFAULT_SETTINGS.reviewDanmakuDensity)
      .trim()
      .toLowerCase();
    return REVIEW_DENSITIES.includes(reviewDanmakuDensity)
      ? reviewDanmakuDensity
      : DEFAULT_SETTINGS.reviewDanmakuDensity;
  }

  function normalizeActiveLevels(levels) {
    if (!Array.isArray(levels)) {
      return DEFAULT_SETTINGS.activeLevels.slice();
    }

    const normalized = levels
      .map((level) =>
        String(level || '')
          .trim()
          .toUpperCase()
      )
      .filter((level) => LEVELS.includes(level));

    return normalized.length
      ? Array.from(new Set(normalized))
      : DEFAULT_SETTINGS.activeLevels.slice();
  }

  function normalizeVocabularyMode(value) {
    const normalized = String(value || DEFAULT_SETTINGS.vocabularyMode)
      .trim()
      .toLowerCase();
    return VOCABULARY_MODES.includes(normalized) ? normalized : DEFAULT_SETTINGS.vocabularyMode;
  }

  function normalizeExamPreference(value) {
    const normalized = String(value || DEFAULT_SETTINGS.examPreference)
      .trim()
      .toLowerCase();
    return EXAM_PREFERENCES.includes(normalized) ? normalized : DEFAULT_SETTINGS.examPreference;
  }

  function normalizeBilingualMode(value) {
    const normalized = String(value || DEFAULT_SETTINGS.bilingualMode)
      .trim()
      .toLowerCase();
    return BILINGUAL_MODES.includes(normalized) ? normalized : DEFAULT_SETTINGS.bilingualMode;
  }

  function normalizeThemeMode(value) {
    const normalized = String(value || DEFAULT_SETTINGS.themeMode)
      .trim()
      .toLowerCase();
    return THEME_MODES.includes(normalized) ? normalized : DEFAULT_SETTINGS.themeMode;
  }

  function normalizeHostname(hostname) {
    const normalized = String(hostname || '')
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '');

    if (!normalized) {
      return '';
    }

    if (normalized === 'localhost') {
      return normalized;
    }

    const segments = normalized.split('.');
    if (segments.length < 2) {
      return '';
    }

    const isValid = segments.every((segment) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(segment));
    return isValid ? normalized : '';
  }

  function normalizeDomainRules(domainRules) {
    if (!domainRules || typeof domainRules !== 'object') {
      return {};
    }

    const normalized = {};
    Object.keys(domainRules).forEach((rawHostname) => {
      const hostname = normalizeHostname(rawHostname);
      if (!hostname) {
        return;
      }

      const rawRule = domainRules[rawHostname];
      if (!rawRule || typeof rawRule !== 'object') {
        return;
      }

      const nextRule = {
        enabled: rawRule.enabled !== false,
      };

      const pausedUntil = Number(rawRule.pausedUntil);
      if (Number.isFinite(pausedUntil) && pausedUntil > 0) {
        nextRule.pausedUntil = Math.floor(pausedUntil);
      }

      normalized[hostname] = nextRule;
    });

    return normalized;
  }

  function setExactDomainRuleEnabled(domainRules, hostname, enabled) {
    const normalizedHostname = normalizeHostname(hostname);
    const normalizedRules = normalizeDomainRules(domainRules);
    if (!normalizedHostname) {
      return normalizedRules;
    }

    normalizedRules[normalizedHostname] = {
      enabled: enabled !== false,
    };
    return normalizedRules;
  }

  function pickMatchedDomainRule(hostname, domainRules) {
    const normalizedHostname = normalizeHostname(hostname);
    if (!normalizedHostname || !domainRules || typeof domainRules !== 'object') {
      return null;
    }

    const exactRule = domainRules[normalizedHostname];
    if (exactRule) {
      return exactRule;
    }

    const segments = normalizedHostname.split('.');
    for (let index = 1; index < segments.length - 1; index += 1) {
      const candidate = segments.slice(index).join('.');
      if (domainRules[candidate]) {
        return domainRules[candidate];
      }
    }

    return null;
  }

  function isDomainEnabled(hostname, settings, now = Date.now()) {
    const normalizedSettings = normalizeSettings(settings);
    if (!normalizedSettings.enabled) {
      return false;
    }

    const matchedRule = pickMatchedDomainRule(hostname, normalizedSettings.domainRules);
    if (!matchedRule) {
      return true;
    }

    if (matchedRule.enabled === false) {
      return false;
    }

    if (Number.isFinite(Number(matchedRule.pausedUntil)) && Number(matchedRule.pausedUntil) > now) {
      return false;
    }

    return true;
  }

  function normalizeSettings(settings) {
    const source = { ...DEFAULT_SETTINGS, ...(settings || {}) };

    return {
      enabled: source.enabled !== false,
      schemaVersion: SCHEMA_VERSION,
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(source.reviewDanmakuSpeed),
      reviewDanmakuDensity: normalizeReviewDanmakuDensity(source.reviewDanmakuDensity),
      vocabularyMode: normalizeVocabularyMode(source.vocabularyMode),
      examPreference: normalizeExamPreference(source.examPreference),
      webPageEnabled: source.webPageEnabled === true,
      domainRules: normalizeDomainRules(source.domainRules),
      activeLevels: normalizeActiveLevels(source.activeLevels),
      replaceRatio: Math.min(
        0.3,
        Math.max(0.1, parseFiniteNumber(source.replaceRatio, DEFAULT_SETTINGS.replaceRatio))
      ),
      maxReplaceCount: Math.min(
        5,
        Math.max(
          1,
          Math.floor(parseFiniteNumber(source.maxReplaceCount, DEFAULT_SETTINGS.maxReplaceCount))
        )
      ),
      targetCefr: normalizeTargetCefr(source.targetCefr),
      bilingualMode: normalizeBilingualMode(source.bilingualMode),
      themeMode: normalizeThemeMode(source.themeMode),
    };
  }

  function normalizeProfileConfig(profile) {
    const normalized = normalizeSettings(profile || {});
    return {
      enabled: normalized.enabled,
      replaceRatio: normalized.replaceRatio,
      maxReplaceCount: normalized.maxReplaceCount,
      targetCefr: normalized.targetCefr,
      activeLevels: normalized.activeLevels.slice(),
      reviewDanmakuSpeed: normalized.reviewDanmakuSpeed,
      reviewDanmakuDensity: normalized.reviewDanmakuDensity,
      vocabularyMode: normalized.vocabularyMode,
      examPreference: normalized.examPreference,
      bilingualMode: normalized.bilingualMode,
      themeMode: normalized.themeMode,
    };
  }

  function createBuiltinProfiles() {
    const base = normalizeProfileConfig(DEFAULT_SETTINGS);
    return {
      gentle: normalizeProfileConfig({
        ...base,
        ...SCENE_PRESETS.light,
        enabled: true,
      }),
      balanced: normalizeProfileConfig({
        ...base,
        ...SCENE_PRESETS.balanced,
        enabled: true,
      }),
      intensive: normalizeProfileConfig({
        ...base,
        ...SCENE_PRESETS.intensive,
        enabled: true,
      }),
    };
  }

  function normalizeOverlayState(state) {
    const source = state && typeof state === 'object' ? state : {};
    return {
      hidden: source.hidden === true,
      collapsed: source.collapsed === true,
      width: clampNumber(
        source.width,
        OVERLAY_BOUNDS.minWidth,
        OVERLAY_BOUNDS.maxWidth,
        OVERLAY_DEFAULTS.width
      ),
      height: clampNumber(
        source.height,
        OVERLAY_BOUNDS.minHeight,
        OVERLAY_BOUNDS.maxHeight,
        OVERLAY_DEFAULTS.height
      ),
      offsetRight: clampNumber(
        source.offsetRight,
        OVERLAY_BOUNDS.minOffsetRight,
        OVERLAY_BOUNDS.maxOffsetRight,
        OVERLAY_DEFAULTS.offsetRight
      ),
      offsetBottom: clampNumber(
        source.offsetBottom,
        OVERLAY_BOUNDS.minOffsetBottom,
        OVERLAY_BOUNDS.maxOffsetBottom,
        OVERLAY_DEFAULTS.offsetBottom
      ),
    };
  }

  function normalizeGlobalControls(rawControls) {
    const source = rawControls && typeof rawControls === 'object' ? rawControls : {};
    return {
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      webPageEnabled: source.webPageEnabled === true,
      siteRules: normalizeDomainRules(source.siteRules),
      overlayState: normalizeOverlayState(source.overlayState),
    };
  }

  function normalizeCustomProfiles(rawProfiles) {
    if (!Array.isArray(rawProfiles)) {
      return [];
    }

    const result = [];
    const usedIds = new Set();
    for (let i = 0; i < rawProfiles.length && result.length < MAX_CUSTOM_PROFILES; i++) {
      const item = rawProfiles[i];
      if (!item || typeof item !== 'object') {
        continue;
      }

      const sourceConfig = item.config && typeof item.config === 'object' ? item.config : item;
      const normalizedConfig = normalizeProfileConfig(sourceConfig);
      const idCandidate = makeProfileId(item.id || item.name || `custom-${i + 1}`);
      if (BUILTIN_PROFILE_IDS.includes(idCandidate) || usedIds.has(idCandidate)) {
        continue;
      }

      usedIds.add(idCandidate);
      result.push({
        id: idCandidate,
        name:
          String(item.name || `自定义 ${result.length + 1}`).trim() ||
          `自定义 ${result.length + 1}`,
        config: normalizedConfig,
        createdAt: Math.max(0, Math.floor(Number(item.createdAt) || Date.now())),
        updatedAt: Math.max(0, Math.floor(Number(item.updatedAt) || Date.now())),
      });
    }
    return result;
  }

  function getDefaultSettingsV3() {
    return {
      schemaVersion: SCHEMA_VERSION_V3,
      activeProfileId: 'balanced',
      profilesBuiltin: createBuiltinProfiles(),
      profilesCustom: [],
      globalControls: normalizeGlobalControls(DEFAULT_SETTINGS),
    };
  }

  function normalizeSettingsV3(payload) {
    const defaults = getDefaultSettingsV3();
    const source = payload && typeof payload === 'object' ? payload : {};

    const rawBuiltin =
      source.profilesBuiltin && typeof source.profilesBuiltin === 'object'
        ? source.profilesBuiltin
        : {};
    const profilesBuiltin = {
      gentle: normalizeProfileConfig({
        ...defaults.profilesBuiltin.gentle,
        ...(rawBuiltin.gentle || {}),
      }),
      balanced: normalizeProfileConfig({
        ...defaults.profilesBuiltin.balanced,
        ...(rawBuiltin.balanced || {}),
      }),
      intensive: normalizeProfileConfig({
        ...defaults.profilesBuiltin.intensive,
        ...(rawBuiltin.intensive || {}),
      }),
    };

    const profilesCustom = normalizeCustomProfiles(source.profilesCustom);
    const customIds = new Set(profilesCustom.map((profile) => profile.id));
    const activeProfileId = String(source.activeProfileId || defaults.activeProfileId).trim();
    const normalizedActiveProfileId =
      BUILTIN_PROFILE_IDS.includes(activeProfileId) || customIds.has(activeProfileId)
        ? activeProfileId
        : defaults.activeProfileId;

    const globalControls = normalizeGlobalControls(source.globalControls);
    return {
      schemaVersion: SCHEMA_VERSION_V3,
      activeProfileId: normalizedActiveProfileId,
      profilesBuiltin,
      profilesCustom,
      globalControls,
    };
  }

  function getProfileConfigById(settingsV3, profileId) {
    const normalized = normalizeSettingsV3(settingsV3);
    if (BUILTIN_PROFILE_IDS.includes(profileId)) {
      return normalized.profilesBuiltin[profileId] || normalized.profilesBuiltin.balanced;
    }
    const custom = normalized.profilesCustom.find((item) => item.id === profileId);
    return custom ? custom.config : normalized.profilesBuiltin.balanced;
  }

  const PROFILE_CONFIG_KEYS = [
    'enabled',
    'replaceRatio',
    'maxReplaceCount',
    'targetCefr',
    'activeLevels',
    'reviewDanmakuSpeed',
    'reviewDanmakuDensity',
    'vocabularyMode',
    'examPreference',
    'bilingualMode',
    'themeMode',
  ];

  function isSameProfileConfig(left, right) {
    const a = normalizeProfileConfig(left);
    const b = normalizeProfileConfig(right);
    return PROFILE_CONFIG_KEYS.every((key) => {
      const av = a[key];
      const bv = b[key];
      if (Array.isArray(av) && Array.isArray(bv)) {
        return av.length === bv.length && av.every((v, i) => v === bv[i]);
      }
      return av === bv;
    });
  }

  function migrateToV3(legacyPayload) {
    if (
      legacyPayload &&
      typeof legacyPayload === 'object' &&
      legacyPayload[SETTINGS_STORAGE_KEY_V3] &&
      typeof legacyPayload[SETTINGS_STORAGE_KEY_V3] === 'object'
    ) {
      return normalizeSettingsV3(legacyPayload[SETTINGS_STORAGE_KEY_V3]);
    }

    if (
      legacyPayload &&
      typeof legacyPayload === 'object' &&
      Number(legacyPayload.schemaVersion) === SCHEMA_VERSION_V3 &&
      legacyPayload.profilesBuiltin
    ) {
      return normalizeSettingsV3(legacyPayload);
    }

    const normalizedLegacy = normalizeSettings(legacyPayload);
    const defaults = getDefaultSettingsV3();
    const result = {
      ...defaults,
      globalControls: normalizeGlobalControls({
        reviewDanmakuEnabled: normalizedLegacy.reviewDanmakuEnabled,
        webPageEnabled: normalizedLegacy.webPageEnabled,
        siteRules: normalizedLegacy.domainRules,
        overlayState: {
          hidden: legacyPayload && legacyPayload.overlayPanelHidden,
          collapsed: legacyPayload && legacyPayload.overlayPanelCollapsed,
          width: legacyPayload && legacyPayload.overlayPanelWidth,
          height: legacyPayload && legacyPayload.overlayPanelHeight,
          offsetRight: legacyPayload && legacyPayload.overlayPanelOffsetRight,
          offsetBottom: legacyPayload && legacyPayload.overlayPanelOffsetBottom,
        },
      }),
    };

    if (!isSameProfileConfig(normalizedLegacy, result.profilesBuiltin.balanced)) {
      const importedProfile = {
        id: 'legacy-imported',
        name: '历史配置',
        config: normalizeProfileConfig(normalizedLegacy),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      result.profilesCustom = [importedProfile];
      result.activeProfileId = importedProfile.id;
    }

    return normalizeSettingsV3(result);
  }

  function resolveEffectiveRuntime(settingsV3, context) {
    const normalizedV3 = normalizeSettingsV3(settingsV3);
    const profile = getProfileConfigById(normalizedV3, normalizedV3.activeProfileId);
    const runtime = normalizeSettings({
      ...profile,
      reviewDanmakuEnabled: normalizedV3.globalControls.reviewDanmakuEnabled,
      webPageEnabled: normalizedV3.globalControls.webPageEnabled,
      domainRules: normalizedV3.globalControls.siteRules,
    });

    const hostname = context && typeof context === 'object' ? context.hostname : '';
    const siteEnabled = isDomainEnabled(hostname, runtime);
    return {
      ...runtime,
      siteEnabled,
    };
  }

  function upsertCustomProfile(settingsV3, profileInput) {
    const normalized = normalizeSettingsV3(settingsV3);
    const input = profileInput && typeof profileInput === 'object' ? profileInput : {};
    const id = makeProfileId(input.id || input.name || `custom-${Date.now()}`);
    if (BUILTIN_PROFILE_IDS.includes(id)) {
      return normalized;
    }

    const nextItem = {
      id,
      name: String(input.name || '自定义配置').trim() || '自定义配置',
      config: normalizeProfileConfig(input.config || input),
      createdAt: Math.max(0, Math.floor(Number(input.createdAt) || Date.now())),
      updatedAt: Date.now(),
    };

    const existingIndex = normalized.profilesCustom.findIndex((item) => item.id === id);
    const nextProfiles = normalized.profilesCustom.slice();
    if (existingIndex >= 0) {
      nextProfiles[existingIndex] = {
        ...nextProfiles[existingIndex],
        ...nextItem,
        createdAt: nextProfiles[existingIndex].createdAt,
      };
    } else if (nextProfiles.length < MAX_CUSTOM_PROFILES) {
      nextProfiles.push(nextItem);
    }

    return normalizeSettingsV3({
      ...normalized,
      profilesCustom: nextProfiles,
    });
  }

  function removeCustomProfile(settingsV3, profileId) {
    const normalized = normalizeSettingsV3(settingsV3);
    const targetId = String(profileId || '').trim();
    if (!targetId) {
      return normalized;
    }

    const nextProfiles = normalized.profilesCustom.filter((item) => item.id !== targetId);
    const nextActiveProfileId =
      normalized.activeProfileId === targetId ? 'balanced' : normalized.activeProfileId;
    return normalizeSettingsV3({
      ...normalized,
      activeProfileId: nextActiveProfileId,
      profilesCustom: nextProfiles,
    });
  }

  function buildSettingsPayload(baseSettings, formValues) {
    const normalizedBase = normalizeSettings(baseSettings);
    const updates = formValues && typeof formValues === 'object' ? formValues : {};
    const source = {
      ...normalizedBase,
      ...updates,
    };

    if (!Object.prototype.hasOwnProperty.call(updates, 'domainRules')) {
      source.domainRules = normalizedBase.domainRules;
    }

    if (!Object.prototype.hasOwnProperty.call(updates, 'schemaVersion')) {
      source.schemaVersion = normalizedBase.schemaVersion;
    }

    return normalizeSettings(source);
  }

  function getReviewDanmakuSpeedLabel(speed) {
    const preset = normalizeReviewDanmakuSpeed(speed);
    if (preset === 'slow') {
      return '慢';
    }
    if (preset === 'fast') {
      return '快';
    }
    return '标准';
  }

  function getReviewDanmakuDensityLabel(density) {
    const preset = normalizeReviewDanmakuDensity(density);
    if (preset === 'sparse') {
      return '低密度';
    }
    if (preset === 'dense') {
      return '高密度';
    }
    return '标准';
  }

  function getBilingualModeLabel(mode) {
    const normalized = normalizeBilingualMode(mode);
    if (normalized === 'bilingual') {
      return '双语对照';
    }
    if (normalized === 'english-only') {
      return '纯英文';
    }
    return '括号释义';
  }

  function getMockPreviewData(targetCefr, ratio, maxReplaceCount) {
    const presetMap = {
      A1: ['learn', 'watch', 'word'],
      A2: ['improve', 'listen', 'memory'],
      B1: ['build', 'focus', 'exposure'],
      B2: ['establish', 'vocabulary', 'context'],
      C1: ['internalize', 'retention', 'comprehension'],
      C2: ['synthesize', 'lexicon', 'fluency'],
    };

    const words = presetMap[normalizeTargetCefr(targetCefr)] || presetMap.B2;
    const normalizedRatio = Math.min(
      0.3,
      Math.max(0.1, parseFiniteNumber(ratio, DEFAULT_SETTINGS.replaceRatio))
    );
    const normalizedMaxReplaceCount = Math.min(
      5,
      Math.max(1, Math.floor(parseFiniteNumber(maxReplaceCount, DEFAULT_SETTINGS.maxReplaceCount)))
    );
    const density = normalizedRatio >= 0.25 ? 3 : normalizedRatio <= 0.15 ? 1 : 2;
    const count = Math.min(words.length, Math.max(1, Math.min(normalizedMaxReplaceCount, density)));
    return words.slice(0, count);
  }

  function getLearningProfile(settings) {
    const normalized = normalizeSettings(settings);
    if (!normalized.enabled) {
      return {
        tone: 'gentle',
        label: '轻量待机',
        summary: '当前未启用，可随时恢复温和输入',
      };
    }

    if (normalized.replaceRatio >= 0.25 || normalized.maxReplaceCount >= 4) {
      return {
        tone: 'intensive',
        label: '强化曝光',
        summary: '适合熟悉内容后集中强化词汇刺激',
      };
    }

    if (normalized.replaceRatio <= 0.15 && normalized.maxReplaceCount <= 2) {
      return {
        tone: 'gentle',
        label: '轻量输入',
        summary: '尽量保留字幕流畅性，降低理解压力',
      };
    }

    return {
      tone: 'balanced',
      label: '均衡输入',
      summary: '理解优先，保持稳定词汇曝光',
    };
  }

  function buildSettingsPreview(settings) {
    const normalized = normalizeSettings(settings);
    if (!normalized.enabled) {
      return '当前字幕替换处于关闭状态。保存并启用后，扩展会按照你的学习目标自动调整词汇曝光。';
    }

    const modeLabel = normalized.vocabularyMode === 'core' ? '核心高频' : '全量扩展';
    const preferenceLabel = normalized.examPreference === 'exam-first' ? '考试优先' : '均衡筛选';
    return `当前会在每句字幕中替换约 ${Math.round(normalized.replaceRatio * 100)}% 的词汇，单句最多 ${normalized.maxReplaceCount} 个词，帮助你以 ${normalized.targetCefr} 难度并结合 ${normalized.activeLevels.length} 个词库持续曝光；词库模式为${modeLabel}，筛选策略为${preferenceLabel}，显示模式为${getBilingualModeLabel(normalized.bilingualMode)}，复习节奏为${getReviewDanmakuSpeedLabel(normalized.reviewDanmakuSpeed)}，复习弹幕密度为${getReviewDanmakuDensityLabel(normalized.reviewDanmakuDensity)}。`;
  }

  function getPresetKeyFromSettings(settings) {
    const normalized = normalizeSettings(settings);
    if (
      normalized.replaceRatio <= SCENE_PRESETS.light.replaceRatio &&
      normalized.maxReplaceCount <= SCENE_PRESETS.light.maxReplaceCount &&
      normalized.reviewDanmakuSpeed === SCENE_PRESETS.light.reviewDanmakuSpeed &&
      normalized.reviewDanmakuDensity === SCENE_PRESETS.light.reviewDanmakuDensity
    ) {
      return 'light';
    }

    if (
      normalized.replaceRatio >= SCENE_PRESETS.intensive.replaceRatio &&
      normalized.maxReplaceCount >= SCENE_PRESETS.intensive.maxReplaceCount &&
      normalized.reviewDanmakuSpeed === SCENE_PRESETS.intensive.reviewDanmakuSpeed &&
      normalized.reviewDanmakuDensity === SCENE_PRESETS.intensive.reviewDanmakuDensity
    ) {
      return 'intensive';
    }

    return 'balanced';
  }

  const api = {
    LEVELS,
    CEFR_LEVELS,
    REVIEW_SPEEDS,
    REVIEW_DENSITIES,
    VOCABULARY_MODES,
    EXAM_PREFERENCES,
    BILINGUAL_MODES,
    THEME_MODES,
    SCHEMA_VERSION,
    SCHEMA_VERSION_V3,
    SETTINGS_STORAGE_KEY_V3,
    BUILTIN_PROFILE_IDS,
    MAX_CUSTOM_PROFILES,
    DEFAULT_SETTINGS,
    SETTINGS_STORAGE_KEYS,
    SCENE_PRESETS,
    OVERLAY_DEFAULTS,
    normalizeHostname,
    normalizeDomainRules,
    setExactDomainRuleEnabled,
    normalizeTargetCefr,
    normalizeReviewDanmakuSpeed,
    normalizeReviewDanmakuDensity,
    normalizeActiveLevels,
    normalizeVocabularyMode,
    normalizeExamPreference,
    normalizeBilingualMode,
    normalizeThemeMode,
    normalizeSettings,
    normalizeProfileConfig,
    createBuiltinProfiles,
    normalizeSettingsV3,
    buildSettingsPayload,
    migrateToV3,
    resolveEffectiveRuntime,
    getDefaultSettingsV3,
    getProfileConfigById,
    upsertCustomProfile,
    removeCustomProfile,
    isDomainEnabled,
    getReviewDanmakuSpeedLabel,
    getReviewDanmakuDensityLabel,
    getBilingualModeLabel,
    getMockPreviewData,
    getLearningProfile,
    buildSettingsPreview,
    getPresetKeyFromSettings,
  };

  globalScope.SharedSettings = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
