(function (globalScope) {
  const LEVELS = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
  const REVIEW_DANMAKU_SPEED_PRESETS = ['slow', 'normal', 'fast'];

  // Dependencies are loaded by background.js importScripts before this module.
  // In Node tests, require() provides the same modules.

  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);

  const OVERLAY_PANEL_DEFAULT_WIDTH = 420;
  const OVERLAY_PANEL_DEFAULT_HEIGHT = 640;
  const OVERLAY_PANEL_DEFAULT_OFFSET_RIGHT = 24;
  const OVERLAY_PANEL_DEFAULT_OFFSET_BOTTOM = 96;
  const OVERLAY_PANEL_MIN_WIDTH = 320;
  const OVERLAY_PANEL_MAX_WIDTH = 560;
  const OVERLAY_PANEL_MIN_HEIGHT = 360;
  const OVERLAY_PANEL_MAX_HEIGHT = 760;
  const OVERLAY_PANEL_MIN_OFFSET_RIGHT = 12;
  const OVERLAY_PANEL_MAX_OFFSET_RIGHT = 360;
  const OVERLAY_PANEL_MIN_OFFSET_BOTTOM = 24;
  const OVERLAY_PANEL_MAX_OFFSET_BOTTOM = 240;

  const config =
    globalScope.Config || (typeof require === 'function' ? require('./config.js') : null);

  const DEFAULT_SETTINGS =
    config && config.DEFAULT_SETTINGS
      ? { ...config.DEFAULT_SETTINGS }
      : {
          enabled: true,
          schemaVersion: 2,
          reviewDanmakuEnabled: false,
          reviewDanmakuSpeed: 'normal',
          webPageEnabled: false,
          domainRules: {},
          vocabularyMode: 'core',
          examPreference: 'balanced',
          activeLevels: LEVELS.slice(),
          replaceRatio: 0.2,
          maxReplaceCount: 2,
          targetCefr: 'B2',
          overlayPanelHidden: false,
          overlayPanelCollapsed: false,
          overlayPanelWidth: OVERLAY_PANEL_DEFAULT_WIDTH,
          overlayPanelHeight: OVERLAY_PANEL_DEFAULT_HEIGHT,
          overlayPanelOffsetRight: OVERLAY_PANEL_DEFAULT_OFFSET_RIGHT,
          overlayPanelOffsetBottom: OVERLAY_PANEL_DEFAULT_OFFSET_BOTTOM,
        };

  // Merge overlay panel defaults that config.js does not include.
  if (config && config.DEFAULT_SETTINGS) {
    DEFAULT_SETTINGS.overlayPanelHidden = false;
    DEFAULT_SETTINGS.overlayPanelCollapsed = false;
    DEFAULT_SETTINGS.overlayPanelWidth = OVERLAY_PANEL_DEFAULT_WIDTH;
    DEFAULT_SETTINGS.overlayPanelHeight = OVERLAY_PANEL_DEFAULT_HEIGHT;
    DEFAULT_SETTINGS.overlayPanelOffsetRight = OVERLAY_PANEL_DEFAULT_OFFSET_RIGHT;
    DEFAULT_SETTINGS.overlayPanelOffsetBottom = OVERLAY_PANEL_DEFAULT_OFFSET_BOTTOM;
  }

  const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  function clampRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) {
      return DEFAULT_SETTINGS.replaceRatio;
    }
    return Math.min(0.3, Math.max(0.1, Number(ratio.toFixed(2))));
  }

  function clampMaxReplaceCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) {
      return DEFAULT_SETTINGS.maxReplaceCount;
    }
    return Math.min(5, Math.max(1, Math.floor(count)));
  }

  function normalizeLevel(level) {
    const normalized = String(level || '')
      .trim()
      .toUpperCase();
    if (!LEVELS.includes(normalized)) {
      return '';
    }
    return normalized;
  }

  function normalizeActiveLevels(levels) {
    if (!Array.isArray(levels)) {
      return [];
    }

    const uniqueLevels = [];
    levels.forEach((level) => {
      const normalized = normalizeLevel(level);
      if (!normalized || uniqueLevels.includes(normalized)) {
        return;
      }
      uniqueLevels.push(normalized);
    });

    return uniqueLevels;
  }

  function normalizeReviewDanmakuSpeed(speed) {
    if (sharedSettings) {
      return sharedSettings.normalizeReviewDanmakuSpeed(speed);
    }

    const normalized = String(speed || DEFAULT_SETTINGS.reviewDanmakuSpeed)
      .trim()
      .toLowerCase();
    return REVIEW_DANMAKU_SPEED_PRESETS.includes(normalized)
      ? normalized
      : DEFAULT_SETTINGS.reviewDanmakuSpeed;
  }

  function clampOverlayPanelWidth(value) {
    const width = Number(value);
    if (!Number.isFinite(width)) {
      return OVERLAY_PANEL_DEFAULT_WIDTH;
    }
    return Math.min(OVERLAY_PANEL_MAX_WIDTH, Math.max(OVERLAY_PANEL_MIN_WIDTH, Math.round(width)));
  }

  function clampOverlayPanelHeight(value) {
    const height = Number(value);
    if (!Number.isFinite(height)) {
      return OVERLAY_PANEL_DEFAULT_HEIGHT;
    }
    return Math.min(
      OVERLAY_PANEL_MAX_HEIGHT,
      Math.max(OVERLAY_PANEL_MIN_HEIGHT, Math.round(height))
    );
  }

  function clampOverlayPanelOffsetRight(value) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) {
      return OVERLAY_PANEL_DEFAULT_OFFSET_RIGHT;
    }
    return Math.min(
      OVERLAY_PANEL_MAX_OFFSET_RIGHT,
      Math.max(OVERLAY_PANEL_MIN_OFFSET_RIGHT, Math.round(offset))
    );
  }

  function clampOverlayPanelOffsetBottom(value) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) {
      return OVERLAY_PANEL_DEFAULT_OFFSET_BOTTOM;
    }
    return Math.min(
      OVERLAY_PANEL_MAX_OFFSET_BOTTOM,
      Math.max(OVERLAY_PANEL_MIN_OFFSET_BOTTOM, Math.round(offset))
    );
  }

  function buildNormalizedBaseSettings(stored, activeLevels) {
    const payload = {
      ...(stored || {}),
      activeLevels,
    };

    if (sharedSettings && typeof sharedSettings.buildSettingsPayload === 'function') {
      return sharedSettings.buildSettingsPayload(DEFAULT_SETTINGS, payload);
    }

    if (sharedSettings) {
      return sharedSettings.normalizeSettings(payload);
    }

    return {
      enabled: stored.enabled !== false,
      reviewDanmakuEnabled: stored.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(stored.reviewDanmakuSpeed),
      vocabularyMode: DEFAULT_SETTINGS.vocabularyMode,
      examPreference: DEFAULT_SETTINGS.examPreference,
      webPageEnabled: stored.webPageEnabled === true,
      domainRules: {},
      schemaVersion: 2,
      activeLevels,
      replaceRatio: clampRatio(stored.replaceRatio),
      maxReplaceCount: clampMaxReplaceCount(stored.maxReplaceCount),
      targetCefr: CEFR_LEVELS.includes(
        String(stored.targetCefr || DEFAULT_SETTINGS.targetCefr)
          .trim()
          .toUpperCase()
      )
        ? String(stored.targetCefr || DEFAULT_SETTINGS.targetCefr)
            .trim()
            .toUpperCase()
        : DEFAULT_SETTINGS.targetCefr,
    };
  }

  function normalizeStoredSettings(storedSettings) {
    const stored = storedSettings || {};
    const activeLevels = normalizeActiveLevels(stored.activeLevels);
    let migratedLevels = activeLevels;
    if (migratedLevels.length === 0) {
      const legacyLevel = normalizeLevel(stored.level);
      migratedLevels = legacyLevel ? [legacyLevel] : LEVELS.slice();
    }

    const normalizedBase = buildNormalizedBaseSettings(stored, migratedLevels);

    return {
      ...normalizedBase,
      overlayPanelHidden: stored.overlayPanelHidden === true,
      overlayPanelCollapsed: stored.overlayPanelCollapsed === true,
      overlayPanelWidth: clampOverlayPanelWidth(stored.overlayPanelWidth),
      overlayPanelHeight: clampOverlayPanelHeight(stored.overlayPanelHeight),
      overlayPanelOffsetRight: clampOverlayPanelOffsetRight(stored.overlayPanelOffsetRight),
      overlayPanelOffsetBottom: clampOverlayPanelOffsetBottom(stored.overlayPanelOffsetBottom),
    };
  }

  function normalizeCommandSettings(storagePayload) {
    if (sharedSettings && typeof sharedSettings.migrateToV3 === 'function') {
      const migrated = sharedSettings.migrateToV3(storagePayload || {});
      if (typeof sharedSettings.normalizeSettingsV3 === 'function') {
        return sharedSettings.normalizeSettingsV3(migrated);
      }
      return migrated;
    }

    return normalizeStoredSettings(storagePayload || {});
  }

  function isSettingsV3Shape(settings) {
    return Boolean(
      settings &&
      typeof settings === 'object' &&
      settings.globalControls &&
      typeof settings.globalControls === 'object' &&
      settings.profilesBuiltin &&
      typeof settings.profilesBuiltin === 'object'
    );
  }

  function patchActiveProfileConfig(settingsV3, patcher) {
    if (!isSettingsV3Shape(settingsV3) || typeof patcher !== 'function') {
      return settingsV3;
    }

    const normalizeV3 =
      sharedSettings && typeof sharedSettings.normalizeSettingsV3 === 'function'
        ? sharedSettings.normalizeSettingsV3
        : (value) => value;
    const normalized = normalizeV3(settingsV3);
    const profileId = String(normalized.activeProfileId || 'balanced').trim();
    const builtinIds = Array.isArray(sharedSettings && sharedSettings.BUILTIN_PROFILE_IDS)
      ? sharedSettings.BUILTIN_PROFILE_IDS
      : ['gentle', 'balanced', 'intensive'];

    if (builtinIds.includes(profileId)) {
      const currentConfig =
        normalized.profilesBuiltin[profileId] || normalized.profilesBuiltin.balanced;
      const nextConfig = patcher({ ...currentConfig });
      return normalizeV3({
        ...normalized,
        profilesBuiltin: {
          ...normalized.profilesBuiltin,
          [profileId]: {
            ...currentConfig,
            ...(nextConfig && typeof nextConfig === 'object' ? nextConfig : {}),
          },
        },
      });
    }

    const customProfiles = Array.isArray(normalized.profilesCustom)
      ? normalized.profilesCustom
      : [];
    const targetIndex = customProfiles.findIndex((item) => item && item.id === profileId);
    if (targetIndex < 0) {
      return normalized;
    }

    const targetProfile = customProfiles[targetIndex];
    const currentConfig =
      targetProfile && targetProfile.config && typeof targetProfile.config === 'object'
        ? targetProfile.config
        : {};
    const nextConfig = patcher({ ...currentConfig });
    const nextProfiles = customProfiles.slice();
    nextProfiles[targetIndex] = {
      ...targetProfile,
      config: {
        ...currentConfig,
        ...(nextConfig && typeof nextConfig === 'object' ? nextConfig : {}),
      },
      updatedAt: Date.now(),
    };

    return normalizeV3({
      ...normalized,
      profilesCustom: nextProfiles,
    });
  }

  const api = {
    LEVELS,
    REVIEW_DANMAKU_SPEED_PRESETS,
    DEFAULT_SETTINGS,
    clampRatio,
    clampMaxReplaceCount,
    normalizeLevel,
    normalizeActiveLevels,
    normalizeReviewDanmakuSpeed: sharedSettings
      ? sharedSettings.normalizeReviewDanmakuSpeed
      : normalizeReviewDanmakuSpeed,
    clampOverlayPanelWidth,
    clampOverlayPanelHeight,
    clampOverlayPanelOffsetRight,
    clampOverlayPanelOffsetBottom,
    normalizeStoredSettings,
    normalizeCommandSettings,
    isSettingsV3Shape,
    patchActiveProfileConfig,
    sharedSettings,
  };

  globalScope.BackgroundSettings = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
