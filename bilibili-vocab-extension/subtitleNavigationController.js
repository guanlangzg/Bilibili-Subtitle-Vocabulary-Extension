(function (globalScope) {
  function requireFunction(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`${name} must be a function`);
    }
    return value;
  }

  function toMessageError(error, fallbackMessage) {
    if (!error) {
      return fallbackMessage;
    }
    const message = String(error.message || error).trim();
    return message || fallbackMessage;
  }

  function signatureFromFields(fields) {
    return fields.map((f) => String(f == null ? '' : f)).join('::');
  }

  function createSubtitleNavigationController(options) {
    const config = options && typeof options === 'object' ? options : {};
    const subtitleNavigation = config.subtitleNavigation || null;
    const overlayBridgeRuntime = config.overlayBridgeRuntime || null;
    const readMessageType = String(
      config.readMessageType || 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ'
    );
    const navigateMessageType = String(
      config.navigateMessageType || 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE'
    );
    const subscribeMessageType = String(
      config.subscribeMessageType || 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE'
    );
    const bridgeKey = String(config.bridgeKey || 'BiliVocabOverlaySubtitleNavigationBridge');
    const getHostname = requireFunction('getHostname', config.getHostname);
    const getVideo = requireFunction('getVideo', config.getVideo);
    const getVideoKey = requireFunction('getVideoKey', config.getVideoKey);
    const loadTimeline = requireFunction('loadTimeline', config.loadTimeline);
    const logError =
      typeof config.logError === 'function'
        ? config.logError
        : (scope, error) => console.error(`[BiliVocab] ${scope}:`, error);
    const isSupportedHostFallback =
      typeof config.isSupportedHostFallback === 'function'
        ? config.isSupportedHostFallback
        : () => false;
    let overlayBridgeController = null;
    let runtimeMessagesWatching = false;
    let runtimeMessageListener = null;
    let runtimeMessageApi = null;
    const runtimeMessaging =
      globalScope.RuntimeMessaging ||
      (typeof require === 'function' ? require('./runtimeMessaging.js') : null);

    function normalizeSubtitleNavigationAction(value) {
      const normalized = String(value || '')
        .trim()
        .toLowerCase();
      return ['previous', 'replay', 'next'].includes(normalized) ? normalized : '';
    }

    function normalizeSubtitleNavigationTimeline(timeline) {
      if (
        subtitleNavigation &&
        typeof subtitleNavigation.normalizeSubtitleTimeline === 'function'
      ) {
        return subtitleNavigation.normalizeSubtitleTimeline(timeline);
      }
      return [];
    }

    function buildSharedSubtitleNavigationState(stateOptions) {
      if (
        subtitleNavigation &&
        typeof subtitleNavigation.buildSubtitleNavigationState === 'function'
      ) {
        return subtitleNavigation.buildSubtitleNavigationState(stateOptions);
      }

      return {
        supported: false,
        loading: false,
        total: 0,
        currentIndex: null,
        progressLabel: '未支持',
        headline: '当前站点暂不支持句级跳转',
        description: '现阶段仅在 Bilibili 字幕时间轴上提供上一句、重播本句和下一句导航。',
        currentText: '切到支持的视频页后即可使用句级字幕导航。',
        previousIndex: null,
        replayIndex: null,
        nextIndex: null,
      };
    }

    function createSubtitleNavigationSnapshotFromState(state) {
      if (
        subtitleNavigation &&
        typeof subtitleNavigation.createActiveTabSubtitleNavigationSnapshot === 'function'
      ) {
        return subtitleNavigation.createActiveTabSubtitleNavigationSnapshot(state);
      }

      return {
        supported: state && state.supported === true,
        progressLabel: String((state && state.progressLabel) || '未支持'),
        headline: String((state && state.headline) || '当前标签页暂无字幕导航'),
        description: String((state && state.description) || '请先打开支持字幕的 Bilibili 视频页。'),
        currentText: String((state && state.currentText) || '还没有可直接跳转的字幕句段。'),
        canGoPrevious: Boolean(state && state.previousIndex != null),
        canReplay: Boolean(state && state.replayIndex != null),
        canGoNext: Boolean(state && state.nextIndex != null),
      };
    }

    function isSubtitleNavigationSupportedHost() {
      const hostname = getHostname();
      if (
        subtitleNavigation &&
        typeof subtitleNavigation.isSubtitleTimelineHostSupported === 'function'
      ) {
        return subtitleNavigation.isSubtitleTimelineHostSupported(hostname);
      }
      return Boolean(isSupportedHostFallback(hostname));
    }

    function findSubtitleNavigationIndices(timeline, currentTime) {
      const normalizedTimeline = normalizeSubtitleNavigationTimeline(timeline);
      if (
        !subtitleNavigation ||
        typeof subtitleNavigation.findSubtitleIndexAtTime !== 'function' ||
        typeof subtitleNavigation.resolveSubtitleNavigationTargets !== 'function'
      ) {
        return {
          currentIndex: -1,
          previousIndex: null,
          replayIndex: null,
          nextIndex: null,
        };
      }

      const currentIndex = subtitleNavigation.findSubtitleIndexAtTime(
        normalizedTimeline,
        currentTime
      );
      const targets = subtitleNavigation.resolveSubtitleNavigationTargets(
        normalizedTimeline,
        currentTime
      );

      return {
        currentIndex,
        previousIndex: targets.previousIndex,
        replayIndex: targets.replayIndex,
        nextIndex: targets.nextIndex,
      };
    }

    function buildSubtitleNavigationSnapshot(timeline, currentTime) {
      const normalizedTimeline = normalizeSubtitleNavigationTimeline(timeline);
      const state = buildSharedSubtitleNavigationState({
        hostname: getHostname() || 'www.bilibili.com',
        loading: false,
        hasVideo: true,
        currentTime,
        timeline: normalizedTimeline,
      });
      return createSubtitleNavigationSnapshotFromState(state);
    }

    function isSubtitleNavigationStreamPort(port) {
      return Boolean(port && port.name === subscribeMessageType);
    }

    function createSubtitleNavigationSnapshotSignature(snapshot) {
      const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
      return signatureFromFields([
        s.supported === true ? '1' : '0',
        s.progressLabel || '',
        s.headline || '',
        s.description || '',
        s.currentText || '',
        s.canGoPrevious === true ? '1' : '0',
        s.canReplay === true ? '1' : '0',
        s.canGoNext === true ? '1' : '0',
      ]);
    }

    function getCurrentSubtitleNavigationVideoKey() {
      return String(getVideoKey() || '');
    }

    function buildOverlayPayload(state, videoKey) {
      return {
        videoKey: String(videoKey || getCurrentSubtitleNavigationVideoKey() || ''),
        state:
          state && typeof state === 'object'
            ? { ...state }
            : buildSharedSubtitleNavigationState({}),
      };
    }

    function cloneOverlaySubtitleNavigationPayload(payload) {
      if (!payload || typeof payload !== 'object') {
        return buildOverlayPayload(buildSharedSubtitleNavigationState({}));
      }
      return {
        videoKey: String(payload.videoKey || ''),
        state:
          payload.state && typeof payload.state === 'object'
            ? { ...payload.state }
            : buildSharedSubtitleNavigationState({}),
      };
    }

    function createOverlaySubtitleNavigationSignature(payload) {
      const p =
        payload && typeof payload === 'object'
          ? payload
          : buildOverlayPayload(buildSharedSubtitleNavigationState({}));
      const s = p.state && typeof p.state === 'object' ? p.state : {};
      return signatureFromFields([
        p.videoKey || '',
        s.supported === true ? '1' : '0',
        s.loading === true ? '1' : '0',
        s.progressLabel || '',
        s.headline || '',
        s.description || '',
        s.currentText || '',
        s.previousIndex,
        s.replayIndex,
        s.nextIndex,
      ]);
    }

    function shouldPreserveCurrentOverlaySubtitleNavigationPayload(currentPayload, nextPayload) {
      if (!currentPayload || !nextPayload || typeof nextPayload !== 'object') {
        return false;
      }

      const currentVideoKey = String(currentPayload.videoKey || '');
      const nextVideoKey = String(nextPayload.videoKey || '');
      if (!currentVideoKey || currentVideoKey !== nextVideoKey) {
        return false;
      }

      const currentState =
        currentPayload.state && typeof currentPayload.state === 'object'
          ? currentPayload.state
          : {};
      const nextState =
        nextPayload.state && typeof nextPayload.state === 'object' ? nextPayload.state : {};
      return currentState.loading !== true && nextState.loading === true;
    }

    function isSubtitleNavigationVideo(value) {
      return Boolean(value && typeof value.currentTime === 'number');
    }

    function buildSubtitleNavigationContext(video, timeline) {
      const normalizedTimeline = normalizeSubtitleNavigationTimeline(timeline);
      const state = buildSharedSubtitleNavigationState({
        hostname: getHostname(),
        loading: false,
        hasVideo: isSubtitleNavigationVideo(video),
        currentTime: isSubtitleNavigationVideo(video) ? Number(video.currentTime) : Number.NaN,
        timeline: normalizedTimeline,
      });

      return {
        timeline: normalizedTimeline,
        video: isSubtitleNavigationVideo(video) ? video : null,
        state,
        snapshot: createSubtitleNavigationSnapshotFromState(state),
      };
    }

    function buildPendingState(videoKey) {
      const video = getVideo();
      const hasVideo = isSubtitleNavigationVideo(video);
      const state = buildSharedSubtitleNavigationState({
        hostname: getHostname(),
        loading: isSubtitleNavigationSupportedHost() && hasVideo,
        hasVideo,
        currentTime: hasVideo ? Number(video.currentTime) : Number.NaN,
        timeline: [],
      });
      return { state, videoKey: String(videoKey || getCurrentSubtitleNavigationVideoKey() || '') };
    }

    function buildPendingOverlayPayload(videoKey) {
      const { state, videoKey: resolvedKey } = buildPendingState(videoKey);
      return buildOverlayPayload(state, resolvedKey);
    }

    function buildPendingRuntimePayload(videoKey) {
      const { state, videoKey: resolvedKey } = buildPendingState(videoKey);
      const snapshot = createSubtitleNavigationSnapshotFromState(state);
      return {
        context: { timeline: [], video: null, state: { ...state }, snapshot },
        videoKey: resolvedKey,
        snapshot,
        overlayPayload: buildOverlayPayload(state, resolvedKey),
      };
    }

    function buildPendingSnapshot() {
      return buildPendingRuntimePayload().snapshot;
    }

    function createRuntimePayload(context, videoKey) {
      return {
        context,
        videoKey: String(videoKey || ''),
        snapshot: context.snapshot,
        overlayPayload: buildOverlayPayload(context.state, videoKey),
      };
    }

    async function readSubtitleNavigationContext() {
      if (!isSubtitleNavigationSupportedHost()) {
        return buildSubtitleNavigationContext(null, []);
      }

      const video = getVideo();
      if (!isSubtitleNavigationVideo(video)) {
        return buildSubtitleNavigationContext(null, []);
      }

      const timeline = await loadTimeline();
      return buildSubtitleNavigationContext(video, timeline);
    }

    async function readSubtitleNavigationSnapshot() {
      return (await readSubtitleNavigationRuntimePayload()).snapshot;
    }

    async function readStableSubtitleNavigationContext(
      requestedVideoKey = getCurrentSubtitleNavigationVideoKey()
    ) {
      const context = await readSubtitleNavigationContext();
      const latestVideoKey = getCurrentSubtitleNavigationVideoKey();
      return {
        context,
        requestedVideoKey: String(requestedVideoKey || ''),
        latestVideoKey: String(latestVideoKey || ''),
        isStale: latestVideoKey !== requestedVideoKey,
      };
    }

    async function readSubtitleNavigationRuntimePayload() {
      const requestedVideoKey = getCurrentSubtitleNavigationVideoKey();
      try {
        const stableContext = await readStableSubtitleNavigationContext(requestedVideoKey);
        if (stableContext.isStale) {
          return buildPendingRuntimePayload(stableContext.latestVideoKey);
        }
        return createRuntimePayload(stableContext.context, stableContext.requestedVideoKey);
      } catch (error) {
        logError('Subtitle navigation runtime payload read failed', error);
        return buildPendingRuntimePayload(getCurrentSubtitleNavigationVideoKey());
      }
    }

    function getOverlaySubtitleNavigationBridgeController() {
      if (overlayBridgeController) {
        return overlayBridgeController;
      }

      if (
        !overlayBridgeRuntime ||
        typeof overlayBridgeRuntime.createOverlaySubtitleNavigationBridgeController !== 'function'
      ) {
        throw new Error('Overlay subtitle navigation bridge runtime unavailable');
      }

      overlayBridgeController =
        overlayBridgeRuntime.createOverlaySubtitleNavigationBridgeController({
          bridgeKey,
          messageType: subscribeMessageType,
          cloneOverlayPayload: cloneOverlaySubtitleNavigationPayload,
          createPendingOverlayPayload: buildPendingOverlayPayload,
          createPendingRuntimePayload: buildPendingRuntimePayload,
          createOverlayPayloadSignature: createOverlaySubtitleNavigationSignature,
          createSnapshotFromState: createSubtitleNavigationSnapshotFromState,
          createSnapshotSignature: createSubtitleNavigationSnapshotSignature,
          shouldPreserveCurrentOverlayPayload:
            shouldPreserveCurrentOverlaySubtitleNavigationPayload,
          readRuntimePayload: readSubtitleNavigationRuntimePayload,
          logError,
        });
      return overlayBridgeController;
    }

    function queueSubtitleNavigationBroadcast() {
      getOverlaySubtitleNavigationBridgeController().queueBroadcast();
    }

    function readOverlaySubtitleNavigationPayload() {
      return getOverlaySubtitleNavigationBridgeController().readOverlayPayload();
    }

    async function refreshOverlaySubtitleNavigation() {
      return getOverlaySubtitleNavigationBridgeController().refreshOverlayPayload();
    }

    function subscribeOverlaySubtitleNavigation(listener) {
      return getOverlaySubtitleNavigationBridgeController().subscribeOverlay(listener);
    }

    function ensureOverlaySubtitleNavigationBridge(targetScope = globalScope) {
      getOverlaySubtitleNavigationBridgeController().ensureGlobalBridge(targetScope);
    }

    async function navigateSubtitleByAction(action) {
      const normalizedAction = normalizeSubtitleNavigationAction(action);
      if (!normalizedAction) {
        throw new Error('Invalid subtitle navigation action');
      }

      let stableContext;
      try {
        stableContext = await readStableSubtitleNavigationContext();
      } catch (error) {
        logError('Subtitle navigation action read failed', error);
        return buildPendingSnapshot();
      }
      if (stableContext.isStale) {
        return buildPendingRuntimePayload(stableContext.latestVideoKey).snapshot;
      }
      const context = stableContext.context;
      if (!context.video) {
        return context.snapshot;
      }

      const targetIndex =
        normalizedAction === 'previous'
          ? context.state.previousIndex
          : normalizedAction === 'replay'
            ? context.state.replayIndex
            : context.state.nextIndex;
      if (
        !subtitleNavigation ||
        typeof subtitleNavigation.seekVideoToSubtitle !== 'function' ||
        subtitleNavigation.seekVideoToSubtitle(context.video, context.timeline, targetIndex) == null
      ) {
        return context.snapshot;
      }

      const snapshot = buildSubtitleNavigationSnapshot(context.timeline, context.video.currentTime);
      queueSubtitleNavigationBroadcast();
      return snapshot;
    }

    function watchRuntimePorts(runtimeApi) {
      const runtime =
        runtimeApi ||
        (globalScope.chrome && globalScope.chrome.runtime ? globalScope.chrome.runtime : null);
      if (!runtime) {
        return;
      }
      getOverlaySubtitleNavigationBridgeController().watchRuntimePorts(runtime);
    }

    function watchRuntimeMessages(runtimeApi) {
      const runtime =
        runtimeApi ||
        (globalScope.chrome && globalScope.chrome.runtime ? globalScope.chrome.runtime : null);
      if (
        runtimeMessagesWatching ||
        !runtime ||
        !runtime.onMessage ||
        typeof runtime.onMessage.addListener !== 'function'
      ) {
        return;
      }

      runtimeMessagesWatching = true;
      runtimeMessageApi = runtime;
      runtimeMessageListener = (message, sender, sendResponse) => {
        if (
          runtimeMessaging &&
          typeof runtimeMessaging.isTrustedExtensionSender === 'function' &&
          !runtimeMessaging.isTrustedExtensionSender(sender)
        ) {
          return false;
        }

        const messageType = String(message && message.type ? message.type : '').trim();
        let task = null;

        if (messageType === readMessageType) {
          task = () => readSubtitleNavigationSnapshot();
        } else if (messageType === navigateMessageType) {
          task = () =>
            navigateSubtitleByAction(message && message.payload && message.payload.action);
        }

        if (!task) {
          return false;
        }

        Promise.resolve()
          .then(task)
          .then(
            (payload) => {
              sendResponse({ ok: true, payload });
            },
            (error) => {
              sendResponse({
                ok: false,
                error: toMessageError(error, 'Subtitle navigation request failed'),
              });
            }
          );
        return true;
      };
      runtime.onMessage.addListener(runtimeMessageListener);
    }

    function stop() {
      if (
        runtimeMessageListener &&
        runtimeMessageApi &&
        runtimeMessageApi.onMessage &&
        typeof runtimeMessageApi.onMessage.removeListener === 'function'
      ) {
        runtimeMessageApi.onMessage.removeListener(runtimeMessageListener);
      }
      runtimeMessageListener = null;
      runtimeMessageApi = null;
      runtimeMessagesWatching = false;
      if (
        overlayBridgeController &&
        typeof overlayBridgeController.stopRuntimePorts === 'function'
      ) {
        overlayBridgeController.stopRuntimePorts();
      }
    }

    return {
      normalizeSubtitleNavigationAction,
      findSubtitleNavigationIndices,
      buildSubtitleNavigationSnapshot,
      createSubtitleNavigationSnapshotSignature,
      createOverlaySubtitleNavigationSignature,
      isSubtitleNavigationStreamPort,
      queueSubtitleNavigationBroadcast,
      readOverlaySubtitleNavigationPayload,
      refreshOverlaySubtitleNavigation,
      subscribeOverlaySubtitleNavigation,
      ensureOverlaySubtitleNavigationBridge,
      navigateSubtitleByAction,
      watchRuntimePorts,
      watchRuntimeMessages,
      stop,
    };
  }

  const api = {
    createSubtitleNavigationController,
  };

  globalScope.BiliVocabSubtitleNavigationControllerRuntime = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
