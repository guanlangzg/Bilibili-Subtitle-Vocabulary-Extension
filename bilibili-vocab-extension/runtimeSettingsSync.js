(function (globalScope) {
  function requireFunction(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`${name} must be a function`);
    }
    return value;
  }

  function createRuntimeSettingsSyncController(options) {
    const config = options && typeof options === 'object' ? options : {};
    const sharedSettings = config.sharedSettings || null;
    const runtimeSettingsKeys = Array.isArray(config.runtimeSettingsKeys)
      ? config.runtimeSettingsKeys.slice()
      : [];
    const settingsStorageKeyV3 = String(config.settingsStorageKeyV3 || 'bili_vocab_settings_v3');
    const learningWordStatsStorageKey = String(
      config.learningWordStatsStorageKey || 'bili_vocab_word_stats_v2'
    );
    const reviewQueueStorageKey = String(
      config.reviewQueueStorageKey || 'bili_vocab_review_queue_v1'
    );
    const learningSummaryStorageKey = String(
      config.learningSummaryStorageKey || 'bili_vocab_learning_summary_v1'
    );
    const normalizeSettingsFallback = requireFunction(
      'normalizeSettingsFallback',
      config.normalizeSettingsFallback
    );
    const createTranslationRuntimeFingerprint = requireFunction(
      'createTranslationRuntimeFingerprint',
      config.createTranslationRuntimeFingerprint
    );
    const resolveSettingsFromV3 = requireFunction(
      'resolveSettingsFromV3',
      config.resolveSettingsFromV3
    );
    const getCurrentSettings = requireFunction('getCurrentSettings', config.getCurrentSettings);
    const setCurrentSettings = requireFunction('setCurrentSettings', config.setCurrentSettings);
    const bumpRenderGeneration = requireFunction(
      'bumpRenderGeneration',
      config.bumpRenderGeneration
    );
    const handleReviewDanmakuSpeedChange = requireFunction(
      'handleReviewDanmakuSpeedChange',
      config.handleReviewDanmakuSpeedChange
    );
    const handleReviewDanmakuChange = requireFunction(
      'handleReviewDanmakuChange',
      config.handleReviewDanmakuChange
    );
    const handleTranslationSettingsChange = requireFunction(
      'handleTranslationSettingsChange',
      config.handleTranslationSettingsChange
    );
    const handleLearningStateChange = requireFunction(
      'handleLearningStateChange',
      config.handleLearningStateChange
    );
    const logError = requireFunction('logError', config.logError);

    let storageChangesWatching = false;
    let storageChangeListener = null;
    let storageChangeTarget = null;

    function normalizeSettings(rawSettings) {
      if (sharedSettings && typeof sharedSettings.normalizeSettings === 'function') {
        return sharedSettings.normalizeSettings(rawSettings);
      }
      return normalizeSettingsFallback(rawSettings);
    }

    function buildRuntimeSettings(baseSettings, updates) {
      if (sharedSettings && typeof sharedSettings.buildSettingsPayload === 'function') {
        return sharedSettings.buildSettingsPayload(baseSettings, updates);
      }
      return normalizeSettings({
        ...(baseSettings || {}),
        ...(updates || {}),
      });
    }

    function classifyRuntimeSettingsChange(previousSettings, nextSettings) {
      const previous = normalizeSettings(previousSettings);
      const next = normalizeSettings(nextSettings);
      return {
        translationChanged:
          createTranslationRuntimeFingerprint(previous) !==
          createTranslationRuntimeFingerprint(next),
        reviewDanmakuChanged: previous.reviewDanmakuEnabled !== next.reviewDanmakuEnabled,
        reviewDanmakuSpeedChanged: previous.reviewDanmakuSpeed !== next.reviewDanmakuSpeed,
        reviewDanmakuDensityChanged: previous.reviewDanmakuDensity !== next.reviewDanmakuDensity,
      };
    }

    function hasRuntimeSettingsChange(changes) {
      if (changes && changes[settingsStorageKeyV3]) {
        return true;
      }
      return runtimeSettingsKeys.some((key) => Boolean(changes && changes[key]));
    }

    function watchStorageChanges(storageApi) {
      const targetStorage =
        storageApi ||
        (globalScope.chrome && globalScope.chrome.storage && globalScope.chrome.storage.onChanged
          ? globalScope.chrome.storage
          : null);

      if (
        storageChangesWatching ||
        !targetStorage ||
        !targetStorage.onChanged ||
        typeof targetStorage.onChanged.addListener !== 'function'
      ) {
        return;
      }

      storageChangesWatching = true;
      storageChangeTarget = targetStorage;
      storageChangeListener = (changes, areaName) => {
        if (areaName !== 'local') {
          return;
        }

        try {
          const v3Changed = Boolean(changes[settingsStorageKeyV3]);
          const learningStateChanged = Boolean(
            changes[learningWordStatsStorageKey] ||
            changes[reviewQueueStorageKey] ||
            changes[learningSummaryStorageKey]
          );
          if (!hasRuntimeSettingsChange(changes) && !learningStateChanged) {
            return;
          }

          const previousSettings = getCurrentSettings();
          let nextSettings = previousSettings;
          if (v3Changed) {
            nextSettings = resolveSettingsFromV3(changes[settingsStorageKeyV3].newValue);
          } else {
            const updates = {};
            runtimeSettingsKeys.forEach((key) => {
              if (!changes[key]) {
                return;
              }
              updates[key] = changes[key].newValue;
            });
            nextSettings = buildRuntimeSettings(previousSettings, updates);
          }

          const {
            translationChanged,
            reviewDanmakuChanged,
            reviewDanmakuSpeedChanged,
            reviewDanmakuDensityChanged,
          } = classifyRuntimeSettingsChange(previousSettings, nextSettings);
          setCurrentSettings(nextSettings);

          if (
            !reviewDanmakuChanged &&
            !reviewDanmakuSpeedChanged &&
            !reviewDanmakuDensityChanged &&
            !translationChanged &&
            !learningStateChanged
          ) {
            return;
          }

          bumpRenderGeneration();

          if (reviewDanmakuSpeedChanged || reviewDanmakuDensityChanged) {
            handleReviewDanmakuSpeedChange();
          }

          if (reviewDanmakuChanged) {
            handleReviewDanmakuChange();
          }

          if (translationChanged) {
            handleTranslationSettingsChange();
          }

          if (learningStateChanged) {
            Promise.resolve()
              .then(() => handleLearningStateChange())
              .catch((error) => logError('Learning state refresh failed', error));
          }
        } catch (error) {
          logError('Runtime settings synchronization failed', error);
        }
      };
      targetStorage.onChanged.addListener(storageChangeListener);
    }

    function stop() {
      if (
        storageChangeListener &&
        storageChangeTarget &&
        storageChangeTarget.onChanged &&
        typeof storageChangeTarget.onChanged.removeListener === 'function'
      ) {
        storageChangeTarget.onChanged.removeListener(storageChangeListener);
      }
      storageChangeListener = null;
      storageChangeTarget = null;
      storageChangesWatching = false;
    }

    return {
      normalizeSettings,
      buildRuntimeSettings,
      classifyRuntimeSettingsChange,
      hasRuntimeSettingsChange,
      watchStorageChanges,
      stop,
    };
  }

  const runtimeApi = {
    createRuntimeSettingsSyncController,
  };

  globalScope.BiliVocabRuntimeSettingsSync = runtimeApi;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = runtimeApi;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
