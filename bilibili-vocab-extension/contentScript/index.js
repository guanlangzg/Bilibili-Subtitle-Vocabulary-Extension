(function () {
  // Runtime markers for review-danmaku package assertions:
  // reviewDanmakuDensity, setDensityPreset
  const C =
    globalThis.BiliVocabContentConstants ||
    (typeof require === 'function' ? require('./constants.js') : null);
  const CONTENT_SCRIPT_INSTANCE_KEY = C.CONTENT_SCRIPT_INSTANCE_KEY;
  const isCommonJsRuntime = typeof module !== 'undefined' && module.exports;
  if (!isCommonJsRuntime && globalThis[CONTENT_SCRIPT_INSTANCE_KEY]) {
    return;
  }
  if (!isCommonJsRuntime) {
    globalThis[CONTENT_SCRIPT_INSTANCE_KEY] = true;
  }

  const sharedSettings = C.sharedSettings;
  const EFFECTIVE_DEFAULTS = C.EFFECTIVE_DEFAULTS;
  const SETTINGS_STORAGE_KEY_V3 = C.SETTINGS_STORAGE_KEY_V3;
  const LEARNING_WORD_STATS_STORAGE_KEY = C.LEARNING_WORD_STATS_STORAGE_KEY;
  const REVIEW_QUEUE_STORAGE_KEY = C.REVIEW_QUEUE_STORAGE_KEY;
  const LEARNING_SUMMARY_STORAGE_KEY = C.LEARNING_SUMMARY_STORAGE_KEY;
  const RUNTIME_SETTINGS_KEYS = C.RUNTIME_SETTINGS_KEYS;
  const WEB_TEXT_PROCESS_INTERVAL = C.WEB_TEXT_PROCESS_INTERVAL;
  const TRANSLATION_CACHE_LIMIT = C.TRANSLATION_CACHE_LIMIT;
  const HIT_SIGNATURE_DATA_KEY = C.HIT_SIGNATURE_DATA_KEY;
  const RENDER_SIGNATURE_DATA_KEY = C.RENDER_SIGNATURE_DATA_KEY;
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_READ = C.ACTIVE_TAB_SUBTITLE_NAVIGATION_READ;
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE = C.ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE;
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE = C.ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE;
  const OVERLAY_SUBTITLE_NAVIGATION_BRIDGE_KEY = C.OVERLAY_SUBTITLE_NAVIGATION_BRIDGE_KEY;

  const hasMethod = C.hasMethod;
  const normalizeText = C.normalizeText;
  const logError = C.logError;
  const logDebug = C.logDebug;
  const isVideoSiteHost = C.isVideoSiteHost;
  const shouldLoadOverlayModuleForHost = C.shouldLoadOverlayModuleForHost;
  const shouldEnableTimelinePolling = C.shouldEnableTimelinePolling;
  const normalizeReviewDanmakuSpeed = C.normalizeReviewDanmakuSpeed;
  const normalizeReviewDanmakuDensity = C.normalizeReviewDanmakuDensity;

  const subtitleNavigation =
    globalThis.SubtitleNavigationShared ||
    (typeof require === 'function' ? require('../subtitleNavigation.js') : null);
  const overlaySubtitleNavigationBridgeRuntime =
    globalThis.BiliVocabOverlaySubtitleNavigationBridgeRuntime ||
    (typeof require === 'function' ? require('../overlaySubtitleNavigationBridge.js') : null);
  const subtitleNavigationControllerRuntime =
    globalThis.BiliVocabSubtitleNavigationControllerRuntime ||
    (typeof require === 'function' ? require('../subtitleNavigationController.js') : null);
  const runtimeSettingsSyncRuntime =
    globalThis.BiliVocabRuntimeSettingsSync ||
    (typeof require === 'function' ? require('../runtimeSettingsSync.js') : null);
  const webTextReplacementRuntime =
    globalThis.BiliVocabWebTextReplacement ||
    (typeof require === 'function' ? require('../webTextReplacement.js') : null);
  const overlayLoaderRuntime =
    globalThis.BiliVocabOverlayLoader ||
    (typeof require === 'function' ? require('../overlayLoader.js') : null);
  const danmakuEngineFactory =
    globalThis.BiliVocabDanmakuEngine ||
    (typeof require === 'function' ? require('./danmaku-engine.js') : null);
  const subtitleNavigationBridgeFactory =
    globalThis.BiliVocabSubtitleNavigationBridge ||
    (typeof require === 'function' ? require('./subtitle-navigation-bridge.js') : null);
  const translationPipelineFactory =
    globalThis.BiliVocabTranslationPipeline ||
    (typeof require === 'function' ? require('./translation-pipeline.js') : null);
  const domObserverFactory =
    globalThis.BiliVocabDomObserver ||
    (typeof require === 'function' ? require('./dom-observer.js') : null);

  // --- Shared mutable state ---
  let settings = { ...EFFECTIVE_DEFAULTS };
  let renderGeneration = 0;
  let boundVideo = null;
  let subtitleNavigationController = null;
  let runtimeSettingsSyncController = null;
  let webTextReplacementController = null;
  let overlayLoaderController = null;
  let lifecycleMessagesWatching = false;
  let lifecycleMessageHandler = null;
  let tornDown = false;

  const LRUCacheCtor =
    globalThis.Utils && typeof globalThis.Utils.LRUCache === 'function'
      ? globalThis.Utils.LRUCache
      : class SimpleMapCache extends Map {
          constructor(limit) {
            super();
            this.limit = limit;
          }

          get(key) {
            if (!this.has(key)) {
              return undefined;
            }
            const value = super.get(key);
            this.delete(key);
            this.set(key, value);
            return value;
          }

          set(key, value) {
            if (this.has(key)) {
              this.delete(key);
            } else if (this.size >= this.limit) {
              const oldestKey = this.keys().next().value;
              if (oldestKey !== undefined) {
                this.delete(oldestKey);
              }
            }
            return super.set(key, value);
          }
        };
  const translationCache = new LRUCacheCtor(TRANSLATION_CACHE_LIMIT);

  // --- Settings management ---
  function normalizeSettingsFallback(rawSettings) {
    const source = { ...EFFECTIVE_DEFAULTS, ...(rawSettings || {}) };
    const activeLevels = Array.isArray(source.activeLevels)
      ? source.activeLevels
          .map((level) =>
            String(level || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      : EFFECTIVE_DEFAULTS.activeLevels.slice();

    return {
      enabled: source.enabled !== false,
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(source.reviewDanmakuSpeed),
      reviewDanmakuDensity: normalizeReviewDanmakuDensity(source.reviewDanmakuDensity),
      activeLevels: activeLevels.length
        ? Array.from(new Set(activeLevels))
        : EFFECTIVE_DEFAULTS.activeLevels.slice(),
      replaceRatio: Math.min(
        0.3,
        Math.max(0.1, Number(source.replaceRatio) || EFFECTIVE_DEFAULTS.replaceRatio)
      ),
      maxReplaceCount: Math.min(
        5,
        Math.max(
          1,
          Math.floor(Number(source.maxReplaceCount) || EFFECTIVE_DEFAULTS.maxReplaceCount)
        )
      ),
      targetCefr: hasMethod(globalThis.SubtitleTranslator, 'normalizeTargetCefr')
        ? globalThis.SubtitleTranslator.normalizeTargetCefr(source.targetCefr)
        : EFFECTIVE_DEFAULTS.targetCefr,
      webPageEnabled: source.webPageEnabled === true,
      domainRules:
        source.domainRules && typeof source.domainRules === 'object' ? source.domainRules : {},
      schemaVersion: Number(source.schemaVersion) || 2,
      vocabularyMode: ['core', 'full'].includes(String(source.vocabularyMode || '').trim())
        ? String(source.vocabularyMode).trim()
        : EFFECTIVE_DEFAULTS.vocabularyMode,
      examPreference: ['balanced', 'exam-first'].includes(
        String(source.examPreference || '').trim()
      )
        ? String(source.examPreference).trim()
        : EFFECTIVE_DEFAULTS.examPreference,
      bilingualMode: ['default', 'bilingual', 'english-only'].includes(
        String(source.bilingualMode || '').trim()
      )
        ? String(source.bilingualMode).trim()
        : EFFECTIVE_DEFAULTS.bilingualMode,
      themeMode: ['auto', 'light', 'dark'].includes(String(source.themeMode || '').trim())
        ? String(source.themeMode).trim()
        : EFFECTIVE_DEFAULTS.themeMode,
    };
  }

  function isCurrentSiteEnabled(runtimeSettings) {
    if (sharedSettings && typeof sharedSettings.isDomainEnabled === 'function') {
      return sharedSettings.isDomainEnabled(
        globalThis.location && globalThis.location.hostname,
        runtimeSettings
      );
    }
    return true;
  }

  function applyStoredSettings(stored) {
    if (
      sharedSettings &&
      typeof sharedSettings.migrateToV3 === 'function' &&
      typeof sharedSettings.resolveEffectiveRuntime === 'function'
    ) {
      const nextV3 = sharedSettings.migrateToV3(stored);
      const storedV3 =
        stored && typeof stored === 'object' ? stored[SETTINGS_STORAGE_KEY_V3] : null;
      if (
        JSON.stringify(storedV3) !== JSON.stringify(nextV3) &&
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local &&
        typeof chrome.storage.local.set === 'function'
      ) {
        chrome.storage.local.set({
          [SETTINGS_STORAGE_KEY_V3]: nextV3,
        });
      }
      settings = sharedSettings.resolveEffectiveRuntime(nextV3, {
        hostname: globalThis.location && globalThis.location.hostname,
      });
      return settings;
    }

    settings = buildRuntimeSettings(EFFECTIVE_DEFAULTS, stored);
    return settings;
  }

  function getSettings() {
    return new Promise((resolve) => {
      const storageApi =
        typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
          ? chrome.storage.local
          : null;
      if (!storageApi || typeof storageApi.get !== 'function') {
        resolve(applyStoredSettings(null));
        return;
      }

      try {
        storageApi.get(null, (stored) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            logError('Settings read failed', chrome.runtime.lastError);
            resolve(applyStoredSettings(null));
            return;
          }
          resolve(applyStoredSettings(stored));
        });
      } catch (error) {
        logError('Settings read failed', error);
        resolve(applyStoredSettings(null));
      }
    });
  }

  // --- Translation pipeline ---
  const translationPipeline = translationPipelineFactory.createTranslationPipeline({
    getSettings() {
      return settings;
    },
    getRenderGeneration() {
      return renderGeneration;
    },
    translationCache,
    normalizeSettings(rawSettings) {
      return getRuntimeSettingsSyncController().normalizeSettings(rawSettings);
    },
    normalizeText,
    logError,
    hasMethod,
    isCurrentSiteEnabled,
    renderSignatureDataKey: RENDER_SIGNATURE_DATA_KEY,
    hitSignatureDataKey: HIT_SIGNATURE_DATA_KEY,
  });

  // --- DOM observer (forward-referenced callbacks resolved below) ---
  let domObserver = null;

  function getDomObserver() {
    if (domObserver) {
      return domObserver;
    }

    domObserver = domObserverFactory.createDomObserver({
      getSettings() {
        return settings;
      },
      MUTATION_OBSERVER_THROTTLE_MS: C.MUTATION_OBSERVER_THROTTLE_MS,
      TIMELINE_POLL_MS: C.TIMELINE_POLL_MS,
      PROCESS_DELAY_MS: C.PROCESS_DELAY_MS,
      LEGACY_WEB_TEXT_PIPELINE_FLAG: C.LEGACY_WEB_TEXT_PIPELINE_FLAG,
      normalizeText,
      logError,
      hasMethod,
      isVideoSiteHost,
      shouldEnableTimelinePolling,
      applyTranslation: translationPipeline.applyTranslation,
      invalidateRenderedSubtitles: translationPipeline.invalidateRenderedSubtitles,
      clearTranslationCache: translationPipeline.clearTranslationCache,
      getWebTextReplacementController() {
        return getWebTextReplacementController();
      },
      ensureRuntimeBindings() {
        ensureRuntimeBindings();
      },
      queueSubtitleNavigationBroadcast() {
        navBridge.queueSubtitleNavigationBroadcast();
      },
      isCurrentSiteEnabled,
      sharedSettings,
    });

    return domObserver;
  }

  // --- Controller factories ---
  function getRuntimeSettingsSyncController() {
    if (runtimeSettingsSyncController) {
      return runtimeSettingsSyncController;
    }

    if (
      !runtimeSettingsSyncRuntime ||
      typeof runtimeSettingsSyncRuntime.createRuntimeSettingsSyncController !== 'function'
    ) {
      throw new Error('Runtime settings synchronization runtime unavailable');
    }

    runtimeSettingsSyncController = runtimeSettingsSyncRuntime.createRuntimeSettingsSyncController({
      sharedSettings,
      runtimeSettingsKeys: RUNTIME_SETTINGS_KEYS,
      settingsStorageKeyV3: SETTINGS_STORAGE_KEY_V3,
      learningWordStatsStorageKey: LEARNING_WORD_STATS_STORAGE_KEY,
      reviewQueueStorageKey: REVIEW_QUEUE_STORAGE_KEY,
      learningSummaryStorageKey: LEARNING_SUMMARY_STORAGE_KEY,
      normalizeSettingsFallback,
      createTranslationRuntimeFingerprint: translationPipeline.createTranslationRuntimeFingerprint,
      resolveSettingsFromV3(nextV3Raw) {
        if (
          sharedSettings &&
          typeof sharedSettings.normalizeSettingsV3 === 'function' &&
          typeof sharedSettings.resolveEffectiveRuntime === 'function'
        ) {
          const nextV3 = sharedSettings.normalizeSettingsV3(nextV3Raw);
          return sharedSettings.resolveEffectiveRuntime(nextV3, {
            hostname: globalThis.location && globalThis.location.hostname,
          });
        }
        return getRuntimeSettingsSyncController().buildRuntimeSettings(settings, nextV3Raw);
      },
      getCurrentSettings() {
        return settings;
      },
      setCurrentSettings(nextSettings) {
        settings = nextSettings;
      },
      bumpRenderGeneration() {
        renderGeneration += 1;
      },
      handleReviewDanmakuSpeedChange() {
        danmakuEngine.syncDanmakuSettings();
      },
      handleReviewDanmakuChange() {
        danmakuEngine.syncEngineWithPlayback();
      },
      handleTranslationSettingsChange() {
        translationPipeline.clearTranslationCache();
        if (webTextReplacementController) {
          webTextReplacementController.clearPendingTimer();
        }
        translationPipeline.invalidateRenderedSubtitles();
        getDomObserver().observeSubtitleChanges();
        getDomObserver().startTimelinePolling();
        getDomObserver().scheduleProcess();
      },
      handleLearningStateChange() {
        if (hasMethod(globalThis.VocabularyModule, 'refreshLearningStateFromStorage')) {
          return globalThis.VocabularyModule.refreshLearningStateFromStorage().then(() => {
            translationPipeline.clearTranslationCache();
            translationPipeline.invalidateRenderedSubtitles();
            getDomObserver().scheduleProcess();
          });
        }
        return null;
      },
      logError,
    });
    return runtimeSettingsSyncController;
  }

  function normalizeSettings(rawSettings) {
    return getRuntimeSettingsSyncController().normalizeSettings(rawSettings);
  }

  function buildRuntimeSettings(baseSettings, updates) {
    return getRuntimeSettingsSyncController().buildRuntimeSettings(baseSettings, updates);
  }

  function classifyRuntimeSettingsChange(previousSettings, nextSettings) {
    return getRuntimeSettingsSyncController().classifyRuntimeSettingsChange(
      previousSettings,
      nextSettings
    );
  }

  function getWebTextReplacementController() {
    if (webTextReplacementController) {
      return webTextReplacementController;
    }

    if (
      !webTextReplacementRuntime ||
      typeof webTextReplacementRuntime.createWebTextReplacementController !== 'function'
    ) {
      throw new Error('Web text replacement runtime unavailable');
    }

    webTextReplacementController = webTextReplacementRuntime.createWebTextReplacementController({
      processIntervalMs: WEB_TEXT_PROCESS_INTERVAL,
      getSettings() {
        return settings;
      },
      getRenderGeneration() {
        return renderGeneration;
      },
      createCacheKey: translationPipeline.createCacheKey,
      readCache(cacheKey) {
        return translationCache.get(cacheKey);
      },
      writeCache(cacheKey, result) {
        translationCache.set(cacheKey, result);
      },
      translateText(text, runtimeSettings) {
        return globalThis.SubtitleTranslator.processSubtitle(text, runtimeSettings);
      },
      normalizeText,
      isVideoSiteHost,
      scheduleProcess() {
        getDomObserver().scheduleProcess();
      },
      logError,
      getDocument() {
        return globalThis.document;
      },
      getHostname() {
        return globalThis.location && globalThis.location.hostname;
      },
    });
    return webTextReplacementController;
  }

  async function importOverlayModuleBundle() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      typeof chrome.runtime.getURL !== 'function'
    ) {
      return null;
    }

    const overlayUrl = chrome.runtime.getURL('dist/overlay.js');
    try {
      await fetch(overlayUrl, { method: 'HEAD' });
    } catch (_error) {
      logError('Overlay module resource unavailable', new Error(`HEAD ${overlayUrl} failed`));
      return null;
    }

    try {
      return await import(overlayUrl);
    } catch (error) {
      logError('Overlay module dynamic import failed', error);
      return null;
    }
  }

  function getOverlayLoaderController() {
    if (overlayLoaderController) {
      return overlayLoaderController;
    }

    if (!overlayLoaderRuntime || typeof overlayLoaderRuntime.createOverlayLoader !== 'function') {
      throw new Error('Overlay loader runtime unavailable');
    }

    overlayLoaderController = overlayLoaderRuntime.createOverlayLoader({
      shouldLoadForHost: shouldLoadOverlayModuleForHost,
      importOverlayModule: importOverlayModuleBundle,
      getHostname() {
        return globalThis.location && globalThis.location.hostname;
      },
      logError,
    });
    return overlayLoaderController;
  }

  function getSubtitleNavigationController() {
    if (subtitleNavigationController) {
      return subtitleNavigationController;
    }

    if (
      !subtitleNavigationControllerRuntime ||
      typeof subtitleNavigationControllerRuntime.createSubtitleNavigationController !== 'function'
    ) {
      throw new Error('Subtitle navigation controller runtime unavailable');
    }

    subtitleNavigationController =
      subtitleNavigationControllerRuntime.createSubtitleNavigationController({
        subtitleNavigation,
        overlayBridgeRuntime: overlaySubtitleNavigationBridgeRuntime,
        readMessageType: ACTIVE_TAB_SUBTITLE_NAVIGATION_READ,
        navigateMessageType: ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE,
        subscribeMessageType: ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE,
        bridgeKey: OVERLAY_SUBTITLE_NAVIGATION_BRIDGE_KEY,
        getHostname() {
          return String((globalThis.location && globalThis.location.hostname) || '');
        },
        getVideo() {
          return document.querySelector('video');
        },
        getVideoKey() {
          if (hasMethod(globalThis.SubtitleParser, 'getCurrentSubtitleTimelineCacheKey')) {
            return globalThis.SubtitleParser.getCurrentSubtitleTimelineCacheKey();
          }
          return '';
        },
        loadTimeline() {
          if (hasMethod(globalThis.SubtitleParser, 'loadSubtitleTimeline')) {
            return globalThis.SubtitleParser.loadSubtitleTimeline();
          }
          return [];
        },
        isSupportedHostFallback(hostname) {
          return Boolean(
            globalThis.SubtitleParser &&
            typeof globalThis.SubtitleParser.isBilibiliHost === 'function' &&
            globalThis.SubtitleParser.isBilibiliHost(hostname)
          );
        },
        logError,
      });
    return subtitleNavigationController;
  }

  function shouldReplaceWebTextNode(result, sourceText) {
    if (
      !webTextReplacementRuntime ||
      typeof webTextReplacementRuntime.shouldReplaceWebTextNode !== 'function'
    ) {
      return false;
    }
    return webTextReplacementRuntime.shouldReplaceWebTextNode(result, sourceText, normalizeText);
  }

  // --- Danmaku engine ---
  const danmakuEngine = danmakuEngineFactory.createDanmakuEngine({
    getSettings() {
      return settings;
    },
    getBoundVideo() {
      return boundVideo;
    },
    setBoundVideo(video) {
      boundVideo = video;
    },
    scheduleProcess() {
      getDomObserver().scheduleProcess();
    },
    invalidateRenderedSubtitles() {
      translationPipeline.invalidateRenderedSubtitles();
    },
    logError,
    sharedSettings,
    normalizeReviewDanmakuSpeed,
    normalizeReviewDanmakuDensity,
    queueSubtitleNavigationBroadcast() {
      navBridge.queueSubtitleNavigationBroadcast();
    },
  });

  // --- Subtitle navigation bridge ---
  const navBridge = subtitleNavigationBridgeFactory.createSubtitleNavigationBridge({
    getSubtitleNavigationController,
    logError,
  });

  // --- Runtime bindings ---
  function ensureRuntimeBindings() {
    danmakuEngine.bindVideoPlaybackEvents();

    if (hasMethod(globalThis.DanmakuModule, 'initDanmakuContainer')) {
      globalThis.DanmakuModule.initDanmakuContainer();
    }

    danmakuEngine.syncDanmakuSettings();
    danmakuEngine.syncEngineWithPlayback();
  }

  function watchRuntimePorts() {
    getSubtitleNavigationController().watchRuntimePorts(
      typeof chrome !== 'undefined' ? chrome.runtime : null
    );
  }

  function watchRuntimeMessages() {
    getSubtitleNavigationController().watchRuntimeMessages(
      typeof chrome !== 'undefined' ? chrome.runtime : null
    );
  }

  function teardownContentRuntime() {
    tornDown = true;
    // Invalidate in-flight applyTranslation work that started before teardown.
    renderGeneration += 1;
    try {
      // Stop chrome event listeners first so no settings change can
      // resurrect observers, timers or video bindings after teardown.
      if (
        runtimeSettingsSyncController &&
        typeof runtimeSettingsSyncController.stop === 'function'
      ) {
        runtimeSettingsSyncController.stop();
      }
      if (subtitleNavigationController && typeof subtitleNavigationController.stop === 'function') {
        subtitleNavigationController.stop();
      }
      stopLifecycleMessages();
      getDomObserver().destroy();
      danmakuEngine.destroy();
      if (webTextReplacementController) {
        webTextReplacementController.clearPendingTimer();
      }
      if (globalThis.TooltipModule && typeof globalThis.TooltipModule.destroy === 'function') {
        globalThis.TooltipModule.destroy();
      }
      translationPipeline.clearTranslationCache();
      translationPipeline.invalidateRenderedSubtitles();
      if (!isCommonJsRuntime) {
        try {
          delete globalThis[CONTENT_SCRIPT_INSTANCE_KEY];
        } catch (_error) {
          globalThis[CONTENT_SCRIPT_INSTANCE_KEY] = false;
        }
      }
    } catch (error) {
      logError('Content runtime teardown failed', error);
    }
  }

  function refreshTranslationsForSelectionStateChange() {
    translationPipeline.clearTranslationCache();
    translationPipeline.invalidateRenderedSubtitles();
    getDomObserver().scheduleProcess();
  }

  function exposeContentRuntimeBridge() {
    globalThis.BiliVocabContentRuntime = {
      refreshTranslationsForSelectionStateChange,
      teardownContentRuntime,
    };
  }

  function stopLifecycleMessages() {
    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
    if (
      lifecycleMessagesWatching &&
      lifecycleMessageHandler &&
      runtime &&
      runtime.onMessage &&
      typeof runtime.onMessage.removeListener === 'function'
    ) {
      runtime.onMessage.removeListener(lifecycleMessageHandler);
    }
    lifecycleMessageHandler = null;
    lifecycleMessagesWatching = false;
  }

  function watchLifecycleMessages() {
    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
    if (
      lifecycleMessagesWatching ||
      !runtime ||
      !runtime.onMessage ||
      typeof runtime.onMessage.addListener !== 'function'
    ) {
      return;
    }
    lifecycleMessagesWatching = true;
    lifecycleMessageHandler = (message, sender, sendResponse) => {
      const runtimeMessaging = globalThis.RuntimeMessaging;
      if (
        runtimeMessaging &&
        typeof runtimeMessaging.isTrustedExtensionSender === 'function' &&
        !runtimeMessaging.isTrustedExtensionSender(sender)
      ) {
        return false;
      }
      if (
        typeof chrome !== 'undefined' &&
        chrome.runtime &&
        chrome.runtime.id &&
        (!sender || sender.id !== chrome.runtime.id)
      ) {
        return false;
      }
      if (!message || message.type !== 'BILI_VOCAB_CONTENT_TEARDOWN') {
        return false;
      }
      teardownContentRuntime();
      sendResponse({ ok: true, payload: { stopped: true } });
      return true;
    };
    runtime.onMessage.addListener(lifecycleMessageHandler);
  }

  function hasRuntimeSettingsChange(changes) {
    return getRuntimeSettingsSyncController().hasRuntimeSettingsChange(changes);
  }

  function watchStorageChanges() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
      return;
    }
    getRuntimeSettingsSyncController().watchStorageChanges(chrome.storage);
  }

  async function loadOverlayModule() {
    return getOverlayLoaderController().load();
  }

  // --- Initialization ---
  async function init() {
    if (tornDown) {
      return;
    }
    const overlayModule = await loadOverlayModule();
    if (tornDown) {
      return;
    }
    if (
      !globalThis.SubtitleParser ||
      !globalThis.SubtitleTranslator ||
      !globalThis.VocabularyModule ||
      !globalThis.SubtitleRenderer ||
      !globalThis.TooltipModule
    ) {
      console.error('[BiliVocab] Required modules are missing.');
      return;
    }

    await Promise.all([
      globalThis.VocabularyModule.loadVocabulary(),
      globalThis.SubtitleParser.loadSubtitleTimeline().catch((error) => {
        logError('Subtitle timeline load failed', error);
        return [];
      }),
    ]);
    if (tornDown) {
      return;
    }
    await getSettings();
    if (tornDown) {
      return;
    }
    translationPipeline.clearTranslationCache();

    globalThis.TooltipModule.init();
    if (overlayModule) {
      try {
        overlayModule.mountOverlayPanel();
      } catch (error) {
        logError('Overlay module mount failed', error);
      }
    }
    ensureRuntimeBindings();
    watchStorageChanges();
    getDomObserver().observeSubtitleChanges();
    getDomObserver().startTimelinePolling();
    getDomObserver().scheduleProcess();

    logDebug('[BiliVocab] Running with settings:', settings);
  }

  exposeContentRuntimeBridge();
  navBridge.ensureOverlaySubtitleNavigationBridge();

  if (document.readyState === 'loading') {
    watchRuntimePorts();
    watchRuntimeMessages();
    watchLifecycleMessages();
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => logError('Initialization failed', error));
    });
  } else {
    watchRuntimePorts();
    watchRuntimeMessages();
    watchLifecycleMessages();
    init().catch((error) => logError('Initialization failed', error));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildRuntimeSettings,
      classifyRuntimeSettingsChange,
      createRenderSignature: translationPipeline.createRenderSignature,
      hasRuntimeSettingsChange,
      isRenderUpToDate: translationPipeline.isRenderUpToDate,
      shouldRunReviewDanmaku: danmakuEngine.shouldRunReviewDanmaku,
      getPlaybackState: danmakuEngine.getPlaybackState,
      watchStorageChanges,
      bindVideoPlaybackEvents: danmakuEngine.bindVideoPlaybackEvents,
      resetHitTrackingIfSourceChanged: translationPipeline.resetHitTrackingIfSourceChanged,
      recordRenderedHits: translationPipeline.recordRenderedHits,
      loadOverlayModule,
      init,
      applyTranslation: translationPipeline.applyTranslation,
      processSubtitles(...args) {
        return getDomObserver().processSubtitles(...args);
      },
      processAll(...args) {
        return getDomObserver().processAll(...args);
      },
      runInAnimationFrame(...args) {
        return getDomObserver().runInAnimationFrame(...args);
      },
      isVideoSiteHost,
      shouldLoadOverlayModuleForHost,
      shouldEnableTimelinePolling,
      shouldObserveDomMutations(...args) {
        return getDomObserver().shouldObserveDomMutations(...args);
      },
      shouldRetargetSubtitleObserver(...args) {
        return getDomObserver().shouldRetargetSubtitleObserver(...args);
      },
      shouldRefreshSubtitleObserver(...args) {
        return getDomObserver().shouldRefreshSubtitleObserver(...args);
      },
      shouldRestoreWebItems(...args) {
        return getDomObserver().shouldRestoreWebItems(...args);
      },
      shouldRunLegacyWebTextPipeline(...args) {
        return getDomObserver().shouldRunLegacyWebTextPipeline(...args);
      },
      shouldReplaceWebTextNode,
      normalizeSubtitleNavigationAction: navBridge.normalizeSubtitleNavigationAction,
      findSubtitleNavigationIndices: navBridge.findSubtitleNavigationIndices,
      buildSubtitleNavigationSnapshot: navBridge.buildSubtitleNavigationSnapshot,
      readOverlaySubtitleNavigationPayload: navBridge.readOverlaySubtitleNavigationPayload,
      refreshOverlaySubtitleNavigation: navBridge.refreshOverlaySubtitleNavigation,
      subscribeOverlaySubtitleNavigation: navBridge.subscribeOverlaySubtitleNavigation,
      teardownContentRuntime,
      refreshTranslationsForSelectionStateChange,
      __readFromCacheForTest: translationPipeline.readFromCache,
      __writeToCacheForTest: translationPipeline.writeToCache,
      __clearTranslationCacheForTest: translationPipeline.clearTranslationCache,
      __resetOverlayModuleStateForTest() {
        if (overlayLoaderController) {
          overlayLoaderController.reset();
        }
        overlayLoaderController = null;
      },
    };
  }
})();
