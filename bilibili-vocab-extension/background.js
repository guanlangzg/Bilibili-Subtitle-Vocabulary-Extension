(function (globalScope) {
  let modulesLoaded = false;
  if (typeof importScripts === 'function') {
    try {
      importScripts(
        'config.js',
        'sharedSettings.js',
        'runtimeMessaging.js',
        'adaptiveTuning.js',
        'experienceMetrics.js',
        'learningState.js',
        'background-settings.js',
        'background-storage.js',
        'background-learning-state.js',
        'background-message-handler.js',
        'background-commands.js'
      );
      modulesLoaded = true;
    } catch (error) {
      // importScripts is unavailable in non-ServiceWorker contexts (e.g. Node tests).
      // Mark as failed so callers can detect partial initialization.
      console.error('[BiliVocab] background importScripts failed:', error);
      modulesLoaded = false;
    }
  }

  // In Node tests, modules are loaded via require() — detect successful load.
  if (!modulesLoaded && typeof require === 'function') {
    try {
      require('./sharedSettings.js');
      require('./background-settings.js');
      require('./background-storage.js');
      require('./background-message-handler.js');
      require('./background-commands.js');
      modulesLoaded = true;
    } catch (_error) {
      modulesLoaded = false;
    }
  }

  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const runtimeMessaging =
    globalScope.RuntimeMessaging ||
    (typeof require === 'function' ? require('./runtimeMessaging.js') : null);
  const adaptiveTuning =
    globalScope.AdaptiveTuning ||
    (typeof require === 'function' ? require('./adaptiveTuning.js') : null);
  const experienceMetrics =
    globalScope.ExperienceMetrics ||
    (typeof require === 'function' ? require('./experienceMetrics.js') : null);
  const backgroundSettings =
    globalScope.BackgroundSettings ||
    (typeof require === 'function' ? require('./background-settings.js') : null);
  const backgroundStorage =
    globalScope.BackgroundStorage ||
    (typeof require === 'function' ? require('./background-storage.js') : null);
  const backgroundMessageHandler =
    globalScope.BackgroundMessageHandler ||
    (typeof require === 'function' ? require('./background-message-handler.js') : null);
  const backgroundCommands =
    globalScope.BackgroundCommands ||
    (typeof require === 'function' ? require('./background-commands.js') : null);

  const SETTINGS_STORAGE_KEY_V3 =
    backgroundStorage && backgroundStorage.SETTINGS_STORAGE_KEY_V3
      ? backgroundStorage.SETTINGS_STORAGE_KEY_V3
      : sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
        ? sharedSettings.SETTINGS_STORAGE_KEY_V3
        : 'bili_vocab_settings_v3';

  const getChromeRuntimeError = backgroundStorage && backgroundStorage.getChromeRuntimeError;
  const logBackgroundError = backgroundStorage && backgroundStorage.logBackgroundError;
  const normalizeStoredSettings = backgroundSettings && backgroundSettings.normalizeStoredSettings;
  const normalizeReviewDanmakuSpeed =
    backgroundSettings && backgroundSettings.normalizeReviewDanmakuSpeed;
  const clampOverlayPanelWidth = backgroundSettings && backgroundSettings.clampOverlayPanelWidth;
  const clampOverlayPanelHeight = backgroundSettings && backgroundSettings.clampOverlayPanelHeight;
  const clampOverlayPanelOffsetRight =
    backgroundSettings && backgroundSettings.clampOverlayPanelOffsetRight;
  const clampOverlayPanelOffsetBottom =
    backgroundSettings && backgroundSettings.clampOverlayPanelOffsetBottom;
  const setStoragePayload = backgroundStorage && backgroundStorage.setStoragePayload;
  const handleBackgroundMessage =
    backgroundMessageHandler && backgroundMessageHandler.handleBackgroundMessage;
  const commitCommandSettings = backgroundCommands && backgroundCommands.commitCommandSettings;

  function safeSendSettingsUpdated(tabId, settings) {
    if (
      typeof chrome === 'undefined' ||
      !chrome.tabs ||
      typeof chrome.tabs.sendMessage !== 'function'
    ) {
      return;
    }

    try {
      chrome.tabs.sendMessage(
        tabId,
        {
          type: 'SETTINGS_UPDATED',
          payload: settings,
        },
        () => {
          if (typeof getChromeRuntimeError === 'function') {
            void getChromeRuntimeError();
          }
        }
      );
    } catch (_error) {
      // Ignore tabs that cannot receive extension messages.
    }
  }

  function ensureDefaultSettings() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.storage ||
      !chrome.storage.local ||
      typeof chrome.storage.local.get !== 'function'
    ) {
      return;
    }

    chrome.storage.local.get(null, (storedSettings) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        // Do not fall back to default settings on read failure; that could
        // overwrite the user's existing configuration.
        if (typeof logBackgroundError === 'function') {
          logBackgroundError(
            'Failed to read settings for initialization',
            chrome.runtime.lastError
          );
        }
        return;
      }
      const normalizedLegacy = normalizeStoredSettings(storedSettings);
      const settingsV3 =
        sharedSettings && typeof sharedSettings.migrateToV3 === 'function'
          ? sharedSettings.migrateToV3(storedSettings)
          : null;
      const nextPayload = settingsV3
        ? {
            [SETTINGS_STORAGE_KEY_V3]: settingsV3,
          }
        : normalizedLegacy;

      setStoragePayload(nextPayload)
        .then(() => {
          if (typeof chrome.storage.local.remove === 'function') {
            const removableKeys = ['level', 'testDanmakuMode'];
            if (Array.isArray(sharedSettings && sharedSettings.SETTINGS_STORAGE_KEYS)) {
              removableKeys.push(...sharedSettings.SETTINGS_STORAGE_KEYS);
            }
            chrome.storage.local.remove(Array.from(new Set(removableKeys)));
          }
        })
        .catch((error) => {
          if (typeof logBackgroundError === 'function') {
            logBackgroundError('Failed to initialize settings', error);
          }
        });
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onInstalled.addListener(() => {
      if (!modulesLoaded) {
        console.error('[BiliVocab] Skipping ensureDefaultSettings: modules failed to load');
        return;
      }
      ensureDefaultSettings();
    });

    chrome.runtime.onStartup.addListener(() => {
      if (!modulesLoaded) {
        console.error('[BiliVocab] Skipping ensureDefaultSettings: modules failed to load');
        return;
      }
      ensureDefaultSettings();
    });

    if (chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === 'function') {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!modulesLoaded) {
          sendResponse({ ok: false, error: 'Background modules not loaded' });
          return false;
        }
        if (typeof handleBackgroundMessage === 'function') {
          return handleBackgroundMessage(message, sender, sendResponse);
        }
        return false;
      });
    }

    // 快捷键命令处理
    if (chrome.commands && typeof chrome.commands.onCommand.addListener === 'function') {
      chrome.commands.onCommand.addListener(async (command) => {
        if (!modulesLoaded) {
          console.error('[BiliVocab] Ignoring command due to module load failure:', command);
          return;
        }
        if (!chrome.storage || !chrome.storage.local) return;
        if (typeof commitCommandSettings !== 'function') return;
        let settings = null;
        try {
          settings = await commitCommandSettings(command);
        } catch (error) {
          if (typeof logBackgroundError === 'function') {
            logBackgroundError('Failed to persist command settings', error);
          }
          return;
        }

        if (!settings || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
          return;
        }

        // 通知所有标签页设置已更新
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (
              tab.id &&
              tab.url &&
              (tab.url.startsWith('http://') || tab.url.startsWith('https://'))
            ) {
              safeSendSettingsUpdated(tab.id, settings);
            }
          });
        });
      });
    }
  }

  const api = {
    LEVELS: backgroundSettings && backgroundSettings.LEVELS,
    REVIEW_DANMAKU_SPEED_PRESETS:
      backgroundSettings && backgroundSettings.REVIEW_DANMAKU_SPEED_PRESETS,
    DEFAULT_SETTINGS: backgroundSettings && backgroundSettings.DEFAULT_SETTINGS,
    normalizeReviewDanmakuSpeed,
    normalizeStoredSettings,
    ensureDefaultSettings,
    clampOverlayPanelWidth,
    clampOverlayPanelHeight,
    clampOverlayPanelOffsetRight,
    clampOverlayPanelOffsetBottom,
  };

  globalScope.BackgroundModule = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
