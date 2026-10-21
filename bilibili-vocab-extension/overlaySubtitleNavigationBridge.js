(function (globalScope) {
  function requireFunction(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`${name} must be a function`);
    }
    return value;
  }

  function createOverlaySubtitleNavigationBridgeController(options) {
    const config = options && typeof options === 'object' ? options : {};
    const bridgeKey = String(config.bridgeKey || 'BiliVocabOverlaySubtitleNavigationBridge');
    const messageType = String(
      config.messageType || 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE'
    );
    const cloneOverlayPayload = requireFunction('cloneOverlayPayload', config.cloneOverlayPayload);
    const createPendingOverlayPayload = requireFunction(
      'createPendingOverlayPayload',
      config.createPendingOverlayPayload
    );
    const createPendingRuntimePayload = requireFunction(
      'createPendingRuntimePayload',
      config.createPendingRuntimePayload
    );
    const createOverlayPayloadSignature = requireFunction(
      'createOverlayPayloadSignature',
      config.createOverlayPayloadSignature
    );
    const createSnapshotFromState = requireFunction(
      'createSnapshotFromState',
      config.createSnapshotFromState
    );
    const createSnapshotSignature = requireFunction(
      'createSnapshotSignature',
      config.createSnapshotSignature
    );
    const shouldPreserveCurrentOverlayPayload = requireFunction(
      'shouldPreserveCurrentOverlayPayload',
      config.shouldPreserveCurrentOverlayPayload
    );
    const readRuntimePayload = requireFunction('readRuntimePayload', config.readRuntimePayload);
    const logError = requireFunction('logError', config.logError);

    const subtitleNavigationPorts = new Set();
    const subtitleNavigationPortSnapshotKeys = new WeakMap();
    const overlaySubtitleNavigationListeners = new Set();
    let subtitleNavigationBroadcastPromise = null;
    let subtitleNavigationBroadcastQueued = false;
    let subtitleNavigationSnapshotSignature = '';
    let subtitleNavigationSnapshotVideoKey = '';
    let overlaySubtitleNavigationSignature = '';
    let overlaySubtitleNavigationPayload = null;
    let runtimePortsWatching = false;
    let runtimePortListener = null;
    let runtimePortApi = null;

    function getPendingOverlayPayload() {
      return createPendingOverlayPayload();
    }

    function getPendingRuntimePayload() {
      return createPendingRuntimePayload();
    }

    function readOverlayPayload() {
      if (overlaySubtitleNavigationPayload) {
        return cloneOverlayPayload(overlaySubtitleNavigationPayload);
      }
      const initialPayload = getPendingOverlayPayload();
      overlaySubtitleNavigationPayload = cloneOverlayPayload(initialPayload);
      overlaySubtitleNavigationSignature = createOverlayPayloadSignature(initialPayload);
      return cloneOverlayPayload(initialPayload);
    }

    function publishOverlayPayload(payload) {
      const nextPayload = cloneOverlayPayload(payload);
      overlaySubtitleNavigationPayload = nextPayload;
      overlaySubtitleNavigationSignature = createOverlayPayloadSignature(nextPayload);
      overlaySubtitleNavigationListeners.forEach((listener) => {
        try {
          listener(cloneOverlayPayload(nextPayload));
        } catch (error) {
          logError('Overlay subtitle navigation bridge update failed', error);
        }
      });
    }

    function subscribeOverlay(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }

      overlaySubtitleNavigationListeners.add(listener);
      listener(readOverlayPayload());
      return () => {
        overlaySubtitleNavigationListeners.delete(listener);
      };
    }

    function createPortSnapshotKey(snapshot, videoKey) {
      return `${String(videoKey || '')}::${createSnapshotSignature(snapshot)}`;
    }

    function rememberSnapshot(snapshot, videoKey) {
      subtitleNavigationSnapshotSignature = createSnapshotSignature(snapshot);
      subtitleNavigationSnapshotVideoKey = String(videoKey || '');
    }

    function isActivePort(port) {
      return (
        port &&
        port.name === messageType &&
        typeof port.postMessage === 'function' &&
        subtitleNavigationPorts.has(port)
      );
    }

    function postSnapshot(port, snapshot, videoKey) {
      if (!isActivePort(port)) {
        return false;
      }

      const nextSnapshotKey = createPortSnapshotKey(snapshot, videoKey);
      if (subtitleNavigationPortSnapshotKeys.get(port) === nextSnapshotKey) {
        return false;
      }

      port.postMessage({
        type: messageType,
        payload: snapshot,
      });
      subtitleNavigationPortSnapshotKeys.set(port, nextSnapshotKey);
      return true;
    }

    function broadcastSnapshot(snapshot, videoKey) {
      rememberSnapshot(snapshot, videoKey);
      subtitleNavigationPorts.forEach((port) => {
        try {
          postSnapshot(port, snapshot, videoKey);
        } catch (error) {
          logError('Subtitle navigation stream update failed', error);
        }
      });
    }

    async function refreshOverlayPayload() {
      const runtimePayload = await readRuntimePayload();
      if (
        shouldPreserveCurrentOverlayPayload(
          overlaySubtitleNavigationPayload,
          runtimePayload.overlayPayload
        )
      ) {
        // Why: a stale async refresh must not regress the current video back to loading.
        return readOverlayPayload();
      }
      const nextOverlaySignature = createOverlayPayloadSignature(runtimePayload.overlayPayload);
      if (nextOverlaySignature !== overlaySubtitleNavigationSignature) {
        publishOverlayPayload(runtimePayload.overlayPayload);
      } else {
        overlaySubtitleNavigationPayload = cloneOverlayPayload(runtimePayload.overlayPayload);
        overlaySubtitleNavigationSignature = nextOverlaySignature;
      }
      return cloneOverlayPayload(runtimePayload.overlayPayload);
    }

    function queueBroadcast() {
      if (subtitleNavigationPorts.size === 0 && overlaySubtitleNavigationListeners.size === 0) {
        return;
      }

      const pendingOverlayPayload = getPendingOverlayPayload();
      const pendingVideoKey = String(pendingOverlayPayload.videoKey || '');
      const pendingOverlaySignature = createOverlayPayloadSignature(pendingOverlayPayload);
      if (
        pendingOverlaySignature !== overlaySubtitleNavigationSignature &&
        pendingOverlayPayload.videoKey !==
          String(
            overlaySubtitleNavigationPayload && overlaySubtitleNavigationPayload.videoKey
              ? overlaySubtitleNavigationPayload.videoKey
              : ''
          )
      ) {
        publishOverlayPayload(pendingOverlayPayload);
      }

      const pendingSnapshot = createSnapshotFromState(pendingOverlayPayload.state);
      const pendingSnapshotSignature = createSnapshotSignature(pendingSnapshot);
      if (
        subtitleNavigationPorts.size > 0 &&
        pendingSnapshotSignature !== subtitleNavigationSnapshotSignature &&
        pendingVideoKey !== subtitleNavigationSnapshotVideoKey
      ) {
        broadcastSnapshot(pendingSnapshot, pendingVideoKey);
      }

      if (subtitleNavigationBroadcastPromise) {
        subtitleNavigationBroadcastQueued = true;
        return;
      }

      subtitleNavigationBroadcastPromise = readRuntimePayload()
        .then((runtimePayload) => {
          const nextSnapshotSignature = createSnapshotSignature(runtimePayload.snapshot);
          if (nextSnapshotSignature !== subtitleNavigationSnapshotSignature) {
            broadcastSnapshot(runtimePayload.snapshot, runtimePayload.videoKey);
          }

          const nextOverlaySignature = createOverlayPayloadSignature(runtimePayload.overlayPayload);
          if (
            shouldPreserveCurrentOverlayPayload(
              overlaySubtitleNavigationPayload,
              runtimePayload.overlayPayload
            )
          ) {
            return;
          }
          if (nextOverlaySignature !== overlaySubtitleNavigationSignature) {
            publishOverlayPayload(runtimePayload.overlayPayload);
            return;
          }
          overlaySubtitleNavigationPayload = cloneOverlayPayload(runtimePayload.overlayPayload);
          overlaySubtitleNavigationSignature = nextOverlaySignature;
        })
        .catch((error) => {
          logError('Subtitle navigation stream refresh failed', error);
        })
        .finally(() => {
          subtitleNavigationBroadcastPromise = null;
          if (!subtitleNavigationBroadcastQueued) {
            return;
          }
          subtitleNavigationBroadcastQueued = false;
          queueBroadcast();
        });
    }

    function watchRuntimePorts(runtimeApi) {
      if (
        runtimePortsWatching ||
        !runtimeApi ||
        !runtimeApi.onConnect ||
        typeof runtimeApi.onConnect.addListener !== 'function'
      ) {
        return;
      }

      runtimePortsWatching = true;
      runtimePortApi = runtimeApi;
      runtimePortListener = (port) => {
        if (!port || port.name !== messageType) {
          return;
        }

        subtitleNavigationPorts.add(port);
        port.onDisconnect.addListener(() => {
          subtitleNavigationPorts.delete(port);
          subtitleNavigationPortSnapshotKeys.delete(port);
        });

        Promise.resolve()
          .then(() => readRuntimePayload())
          .then((runtimePayload) => {
            if (!postSnapshot(port, runtimePayload.snapshot, runtimePayload.videoKey)) {
              return;
            }
            rememberSnapshot(runtimePayload.snapshot, runtimePayload.videoKey);
          })
          .catch((error) => {
            if (!subtitleNavigationPorts.has(port)) {
              return;
            }
            logError('Subtitle navigation stream init failed', error);
            try {
              const pendingRuntimePayload = getPendingRuntimePayload();
              if (
                !postSnapshot(port, pendingRuntimePayload.snapshot, pendingRuntimePayload.videoKey)
              ) {
                return;
              }
              rememberSnapshot(pendingRuntimePayload.snapshot, pendingRuntimePayload.videoKey);
            } catch (fallbackError) {
              logError('Subtitle navigation stream fallback failed', fallbackError);
            }
          });
      };
      runtimeApi.onConnect.addListener(runtimePortListener);
    }

    function stopRuntimePorts() {
      if (
        runtimePortListener &&
        runtimePortApi &&
        runtimePortApi.onConnect &&
        typeof runtimePortApi.onConnect.removeListener === 'function'
      ) {
        runtimePortApi.onConnect.removeListener(runtimePortListener);
      }
      runtimePortListener = null;
      runtimePortApi = null;
      runtimePortsWatching = false;
      subtitleNavigationPorts.clear();
    }

    function ensureGlobalBridge(target) {
      const bridgeTarget = target && typeof target === 'object' ? target : globalScope;
      bridgeTarget[bridgeKey] = {
        read() {
          return readOverlayPayload();
        },
        refresh() {
          return refreshOverlayPayload();
        },
        subscribe(listener) {
          return subscribeOverlay(listener);
        },
      };
      return bridgeTarget[bridgeKey];
    }

    return {
      readOverlayPayload,
      refreshOverlayPayload,
      subscribeOverlay,
      queueBroadcast,
      watchRuntimePorts,
      stopRuntimePorts,
      ensureGlobalBridge,
    };
  }

  const runtimeApi = {
    createOverlaySubtitleNavigationBridgeController,
  };

  globalScope.BiliVocabOverlaySubtitleNavigationBridgeRuntime = runtimeApi;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = runtimeApi;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
