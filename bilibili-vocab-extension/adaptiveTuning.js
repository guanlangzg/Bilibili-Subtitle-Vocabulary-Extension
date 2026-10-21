(function (globalScope) {
  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const runtimeMessaging =
    globalScope.RuntimeMessaging ||
    (typeof require === 'function' ? require('./runtimeMessaging.js') : null);
  const experienceMetrics =
    globalScope.ExperienceMetrics ||
    (typeof require === 'function' ? require('./experienceMetrics.js') : null);
  const STORAGE_KEYS = {
    STATE: 'bili_vocab_adaptive_tuning_v1',
    SETTINGS_V3:
      sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
        ? sharedSettings.SETTINGS_STORAGE_KEY_V3
        : 'bili_vocab_settings_v3',
  };

  const DEFAULT_STATE = {
    enabled: true,
    feedbackWindow: [],
    windowLimit: 12,
    minFeedbackToAdjust: 6,
    lastAppliedAt: null,
    lastAppliedMode: '',
    manualOverrideUntil: null,
  };

  const APPLY_COOLDOWN_MS = 5 * 60 * 1000;
  const MANUAL_OVERRIDE_MS = 20 * 60 * 1000;
  const ACTIONS = ['know', 'fuzzy', 'dontknow'];
  const REVIEW_SPEEDS =
    sharedSettings && Array.isArray(sharedSettings.REVIEW_SPEEDS)
      ? sharedSettings.REVIEW_SPEEDS.slice()
      : ['slow', 'normal', 'fast'];

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    return Math.floor(timestamp);
  }

  function clampRatio(value) {
    const numeric = Number(value);
    const fallback = sharedSettings ? sharedSettings.DEFAULT_SETTINGS.replaceRatio : 0.2;
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(0.3, Math.max(0.1, Number(numeric.toFixed(2))));
  }

  function clampMaxReplaceCount(value) {
    const numeric = Number(value);
    const fallback = sharedSettings ? sharedSettings.DEFAULT_SETTINGS.maxReplaceCount : 2;
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(5, Math.max(1, Math.floor(numeric)));
  }

  function normalizeReviewSpeed(speed) {
    const normalized = String(speed || '')
      .trim()
      .toLowerCase();
    if (REVIEW_SPEEDS.includes(normalized)) {
      return normalized;
    }
    return sharedSettings ? sharedSettings.DEFAULT_SETTINGS.reviewDanmakuSpeed : 'normal';
  }

  function normalizeReviewDensity(density) {
    if (sharedSettings && typeof sharedSettings.normalizeReviewDanmakuDensity === 'function') {
      return sharedSettings.normalizeReviewDanmakuDensity(density);
    }
    const normalized = String(density || '')
      .trim()
      .toLowerCase();
    return ['sparse', 'normal', 'dense'].includes(normalized) ? normalized : 'normal';
  }

  function normalizeAction(action) {
    const normalized = String(action || '')
      .trim()
      .toLowerCase();
    if (normalized === 'dontknow') {
      return 'dontknow';
    }
    if (normalized === 'know' || normalized === 'fuzzy') {
      return normalized;
    }
    return '';
  }

  function normalizeFeedbackWindow(rawWindow, windowLimit) {
    if (!Array.isArray(rawWindow)) {
      return [];
    }

    const normalized = rawWindow
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const action = normalizeAction(item.action);
        const at = normalizeTimestamp(item.at);
        if (!action || at == null) {
          return null;
        }
        return { action, at };
      })
      .filter(Boolean);

    if (normalized.length <= windowLimit) {
      return normalized;
    }
    return normalized.slice(normalized.length - windowLimit);
  }

  function normalizeState(rawState) {
    const source = rawState && typeof rawState === 'object' ? rawState : {};
    const windowLimit = Math.min(
      20,
      Math.max(4, Math.floor(Number(source.windowLimit) || DEFAULT_STATE.windowLimit))
    );
    const minFeedbackToAdjust = Math.min(
      windowLimit,
      Math.max(
        3,
        Math.floor(Number(source.minFeedbackToAdjust) || DEFAULT_STATE.minFeedbackToAdjust)
      )
    );
    const feedbackWindow = normalizeFeedbackWindow(source.feedbackWindow, windowLimit);
    return {
      enabled: source.enabled !== false,
      feedbackWindow,
      windowLimit,
      minFeedbackToAdjust,
      lastAppliedAt: normalizeTimestamp(source.lastAppliedAt),
      lastAppliedMode: String(source.lastAppliedMode || '')
        .trim()
        .toLowerCase(),
      manualOverrideUntil: normalizeTimestamp(source.manualOverrideUntil),
    };
  }

  function recordFeedback(state, action, now = Date.now()) {
    const normalizedState = normalizeState(state);
    const normalizedAction = normalizeAction(action);
    if (!normalizedAction) {
      return normalizedState;
    }

    const timestamp = normalizeTimestamp(now) || Date.now();
    const feedbackWindow = normalizedState.feedbackWindow
      .concat([{ action: normalizedAction, at: timestamp }])
      .slice(-normalizedState.windowLimit);

    return {
      ...normalizedState,
      feedbackWindow,
    };
  }

  function markManualOverride(state, now = Date.now(), durationMs = MANUAL_OVERRIDE_MS) {
    const normalizedState = normalizeState(state);
    const timestamp = normalizeTimestamp(now) || Date.now();
    const duration = Math.max(60 * 1000, Math.floor(Number(durationMs) || MANUAL_OVERRIDE_MS));
    return {
      ...normalizedState,
      manualOverrideUntil: timestamp + duration,
    };
  }

  function getProfileConfig(settingsV3) {
    if (
      !sharedSettings ||
      typeof sharedSettings.getProfileConfigById !== 'function' ||
      typeof sharedSettings.normalizeSettingsV3 !== 'function'
    ) {
      return {
        replaceRatio: 0.2,
        maxReplaceCount: 2,
        reviewDanmakuSpeed: 'normal',
        enabled: true,
      };
    }

    const normalizedV3 = sharedSettings.normalizeSettingsV3(settingsV3 || {});
    return sharedSettings.getProfileConfigById(normalizedV3, normalizedV3.activeProfileId);
  }

  function getSteppedReviewSpeed(currentSpeed, step) {
    const normalized = normalizeReviewSpeed(currentSpeed);
    const index = Math.max(0, REVIEW_SPEEDS.indexOf(normalized));
    const targetIndex = Math.min(REVIEW_SPEEDS.length - 1, Math.max(0, index + step));
    return REVIEW_SPEEDS[targetIndex];
  }

  function summarizeFeedback(feedbackWindow) {
    const summary = {
      total: feedbackWindow.length,
      know: 0,
      fuzzy: 0,
      dontknow: 0,
    };
    feedbackWindow.forEach((item) => {
      if (!item || !item.action) {
        return;
      }
      if (item.action === 'know') summary.know += 1;
      if (item.action === 'fuzzy') summary.fuzzy += 1;
      if (item.action === 'dontknow') summary.dontknow += 1;
    });
    return summary;
  }

  function applyDecisionToProfile(profile, decision) {
    const source = profile && typeof profile === 'object' ? profile : {};
    return {
      ...source,
      replaceRatio: clampRatio(
        (Number(source.replaceRatio) || 0.2) + (Number(decision.ratioDelta) || 0)
      ),
      maxReplaceCount: clampMaxReplaceCount(
        (Number(source.maxReplaceCount) || 2) + (Number(decision.maxReplaceCountDelta) || 0)
      ),
      reviewDanmakuSpeed: normalizeReviewSpeed(
        decision.reviewDanmakuSpeed || source.reviewDanmakuSpeed
      ),
      reviewDanmakuDensity: normalizeReviewDensity(
        decision.reviewDanmakuDensity || source.reviewDanmakuDensity
      ),
    };
  }

  function hasProfileChanged(before, after) {
    return (
      clampRatio(before.replaceRatio) !== clampRatio(after.replaceRatio) ||
      clampMaxReplaceCount(before.maxReplaceCount) !==
        clampMaxReplaceCount(after.maxReplaceCount) ||
      normalizeReviewSpeed(before.reviewDanmakuSpeed) !==
        normalizeReviewSpeed(after.reviewDanmakuSpeed) ||
      normalizeReviewDensity(before.reviewDanmakuDensity) !==
        normalizeReviewDensity(after.reviewDanmakuDensity)
    );
  }

  function decideAdjustment(state, profile, now = Date.now()) {
    const normalizedState = normalizeState(state);
    const normalizedProfile = {
      replaceRatio: clampRatio(profile && profile.replaceRatio),
      maxReplaceCount: clampMaxReplaceCount(profile && profile.maxReplaceCount),
      reviewDanmakuSpeed: normalizeReviewSpeed(profile && profile.reviewDanmakuSpeed),
      reviewDanmakuDensity: normalizeReviewDensity(profile && profile.reviewDanmakuDensity),
    };
    const timestamp = normalizeTimestamp(now) || Date.now();

    if (!normalizedState.enabled) {
      return { shouldApply: false, reason: 'disabled' };
    }
    if (
      normalizedState.manualOverrideUntil != null &&
      normalizedState.manualOverrideUntil > timestamp
    ) {
      return { shouldApply: false, reason: 'manual-override' };
    }
    if (normalizedState.feedbackWindow.length < normalizedState.minFeedbackToAdjust) {
      return { shouldApply: false, reason: 'insufficient-feedback' };
    }
    if (
      normalizedState.lastAppliedAt != null &&
      timestamp - normalizedState.lastAppliedAt < APPLY_COOLDOWN_MS
    ) {
      return { shouldApply: false, reason: 'cooldown' };
    }

    const summary = summarizeFeedback(normalizedState.feedbackWindow);
    const total = summary.total || 1;
    const dontKnowRate = summary.dontknow / total;
    const knowRate = summary.know / total;
    const fuzzyRate = summary.fuzzy / total;

    let decision = null;
    if (dontKnowRate >= 0.5 || summary.dontknow >= 4) {
      decision = {
        mode: 'ease-down',
        ratioDelta: -0.02,
        maxReplaceCountDelta: -1,
        reviewDanmakuSpeed: getSteppedReviewSpeed(normalizedProfile.reviewDanmakuSpeed, -1),
      };
    } else if (knowRate >= 0.7 && summary.dontknow === 0) {
      decision = {
        mode: 'ramp-up',
        ratioDelta: 0.02,
        maxReplaceCountDelta: 1,
        reviewDanmakuSpeed: getSteppedReviewSpeed(normalizedProfile.reviewDanmakuSpeed, 1),
      };
    } else if (fuzzyRate >= 0.5 && normalizedProfile.reviewDanmakuSpeed === 'fast') {
      decision = {
        mode: 'stabilize',
        ratioDelta: 0,
        maxReplaceCountDelta: 0,
        reviewDanmakuSpeed: 'normal',
      };
    }

    if (!decision) {
      return { shouldApply: false, reason: 'no-signal', summary };
    }

    const nextProfile = applyDecisionToProfile(normalizedProfile, decision);
    if (!hasProfileChanged(normalizedProfile, nextProfile)) {
      return { shouldApply: false, reason: 'no-change', summary, mode: decision.mode };
    }

    return {
      shouldApply: true,
      reason: 'apply',
      mode: decision.mode,
      ratioDelta: decision.ratioDelta,
      maxReplaceCountDelta: decision.maxReplaceCountDelta,
      reviewDanmakuSpeed: decision.reviewDanmakuSpeed,
      summary,
      nextProfile,
    };
  }

  function patchActiveProfileConfig(settingsV3, nextProfile) {
    if (
      !sharedSettings ||
      typeof sharedSettings.normalizeSettingsV3 !== 'function' ||
      typeof sharedSettings.normalizeProfileConfig !== 'function'
    ) {
      return settingsV3;
    }

    const normalized = sharedSettings.normalizeSettingsV3(settingsV3 || {});
    const profileId = String(normalized.activeProfileId || 'balanced').trim();
    const nextConfig = sharedSettings.normalizeProfileConfig(nextProfile || {});
    if (
      Array.isArray(sharedSettings.BUILTIN_PROFILE_IDS) &&
      sharedSettings.BUILTIN_PROFILE_IDS.includes(profileId)
    ) {
      return sharedSettings.normalizeSettingsV3({
        ...normalized,
        profilesBuiltin: {
          ...normalized.profilesBuiltin,
          [profileId]: {
            ...normalized.profilesBuiltin[profileId],
            ...nextConfig,
          },
        },
      });
    }

    const profilesCustom = Array.isArray(normalized.profilesCustom)
      ? normalized.profilesCustom.slice()
      : [];
    const index = profilesCustom.findIndex((item) => item && item.id === profileId);
    if (index < 0) {
      return normalized;
    }

    const target = profilesCustom[index];
    profilesCustom[index] = {
      ...target,
      config: {
        ...(target && target.config && typeof target.config === 'object' ? target.config : {}),
        ...nextConfig,
      },
      updatedAt: Date.now(),
    };
    return sharedSettings.normalizeSettingsV3({
      ...normalized,
      profilesCustom,
    });
  }

  function applyFeedbackToPayload(storagePayload, feedback, now = Date.now()) {
    if (
      !sharedSettings ||
      typeof sharedSettings.migrateToV3 !== 'function' ||
      typeof sharedSettings.normalizeSettingsV3 !== 'function'
    ) {
      const state = recordFeedback(
        normalizeState(storagePayload && storagePayload[STORAGE_KEYS.STATE]),
        feedback,
        now
      );
      return {
        applied: false,
        decision: { shouldApply: false, reason: 'unsupported' },
        nextState: state,
        nextSettingsV3: null,
      };
    }

    const payload = storagePayload && typeof storagePayload === 'object' ? storagePayload : {};
    const nextState = recordFeedback(normalizeState(payload[STORAGE_KEYS.STATE]), feedback, now);
    const settingsV3 = sharedSettings.normalizeSettingsV3(sharedSettings.migrateToV3(payload));
    const currentProfile = getProfileConfig(settingsV3);
    const decision = decideAdjustment(nextState, currentProfile, now);

    if (!decision.shouldApply) {
      return {
        applied: false,
        decision,
        nextState,
        nextSettingsV3: settingsV3,
      };
    }

    const timestamp = normalizeTimestamp(now) || Date.now();
    const appliedState = normalizeState({
      ...nextState,
      lastAppliedAt: timestamp,
      lastAppliedMode: decision.mode,
    });
    const nextSettingsV3 = patchActiveProfileConfig(settingsV3, decision.nextProfile);
    return {
      applied: true,
      decision,
      nextState: appliedState,
      nextSettingsV3,
    };
  }

  function readStorage(keys) {
    return new Promise((resolve) => {
      if (
        typeof chrome === 'undefined' ||
        !chrome.storage ||
        !chrome.storage.local ||
        typeof chrome.storage.local.get !== 'function'
      ) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (payload) => resolve(payload || {}));
    });
  }

  function writeStorage(payload) {
    return new Promise((resolve) => {
      if (
        typeof chrome === 'undefined' ||
        !chrome.storage ||
        !chrome.storage.local ||
        typeof chrome.storage.local.set !== 'function'
      ) {
        resolve(false);
        return;
      }
      chrome.storage.local.set(payload, () => resolve(true));
    });
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
      // Ignore metrics failures; do not affect learning flow.
    }
  }

  async function persistFeedback(feedback, options = {}) {
    if (
      runtimeMessaging &&
      typeof runtimeMessaging.sendRuntimeMessage === 'function' &&
      typeof runtimeMessaging.hasRuntimeMessaging === 'function' &&
      runtimeMessaging.hasRuntimeMessaging()
    ) {
      return runtimeMessaging.sendRuntimeMessage(
        runtimeMessaging.MESSAGE_TYPES.ADAPTIVE_PERSIST_FEEDBACK,
        {
          feedback,
          options: { ...(options || {}) },
        }
      );
    }

    const now = normalizeTimestamp(options.now) || Date.now();
    const payload = await readStorage([STORAGE_KEYS.STATE, STORAGE_KEYS.SETTINGS_V3]);
    const result = applyFeedbackToPayload(payload, feedback, now);
    const patch = {
      [STORAGE_KEYS.STATE]: result.nextState,
    };
    if (result.applied && result.nextSettingsV3) {
      patch[STORAGE_KEYS.SETTINGS_V3] = result.nextSettingsV3;
    }
    await writeStorage(patch);
    if (result && result.applied && result.decision && result.decision.mode) {
      recordExperienceMetric('adaptive-decision-applied', {
        mode: result.decision.mode,
        now,
      });
    }
    return result;
  }

  const api = {
    STORAGE_KEYS,
    DEFAULT_STATE,
    APPLY_COOLDOWN_MS,
    MANUAL_OVERRIDE_MS,
    normalizeAction,
    normalizeState,
    recordFeedback,
    markManualOverride,
    decideAdjustment,
    applyFeedbackToPayload,
    persistFeedback,
  };

  globalScope.AdaptiveTuning = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
